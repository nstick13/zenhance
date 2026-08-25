# V2 build plan — canvas map, story by story

> **Read [V2.md](V2.md) first** for *why* v2 exists and what the lab proved. This file is the *how*:
> seven stories, each a branch, each with files / definition-of-done / known traps.
> Decisions taken 2026-08-25 with Nate are recorded in V2.md's decisions table — they are settled,
> don't re-open them.

## Where we actually are (correcting ROADMAP.md)

ROADMAP's "▶ Next build" still lists Track 1 (findings UI) and Track 2 (`reports_to`) as upcoming.
**Both shipped** — `lib/analytics/findings.ts` + `FindingsRail` in commit `3d1287c`, `people.managerId`
+ formal map mode in `2a9b835`. Production is v0.1.7 on the radial/SVG viz with drill-down, zoom/pan,
overlays, findings rail, scenario mode, drag-to-reassign and the formal layer.

The canvas lab (`app/lab/canvas`) is a **feel study on client-side mock data**. Nothing in
`app/(app)` or `lib/` knows canvas exists. V2.0 is the first production line of it.

## The one design rule that makes this cheap

> **A missing position row is not an error — it's a computed fallback.**

Render position resolves as `stored ?? computed`:

| Node | Fallback |
|---|---|
| person | `seedLayout()` — ring around their home squad |
| team (leaf unit) | `seedLayout()` — ring around its group |
| group | centroid of its placed children, else `seedLayout()` |

Consequences worth internalising: **no write ever happens on a page read** (no first-open bulk insert,
no race, no write-from-GET); a freshly imported or demo org renders correctly with **zero** `map_nodes`
rows; and `seedLayout()` is the same pure function that later becomes the **"Tidy up"** command.
Build it once, in S1, as a tested pure function.

## Story sequence

`S1` and `S3` have no dependency on each other and can run as **parallel sessions**. Everything else is serial.

```
S1 map-core ──► S2 canvas-viewport ──► S4 canvas-parity ──► S5 radial-retire ──► S6 zones-layers ──► S7 touch-a11y
S3 paper-shell ──────────────────────►┘
```

Patch-bump `package.json` per merge. **Minor bump to 0.2.0 when S4 flips canvas to the default.**

---

## S1 · `v2-map-core` — pure model + persistence, no UI

Nothing renders in this story. That's deliberate: it is all pure functions and one migration, so it is
fully testable and the next session starts from a solid seam.

**New — `lib/map/`**

| File | Contents |
|---|---|
| `types.ts` | `MapNodeKind = "unit" \| "person"`, `MapPosition { kind, id, x, y }`, `MapNode`, `MapEdge`, `MapGraph`. Model on `app/lab/canvas/demoMap.ts`'s types — that shape is proven — but source from real rows. |
| `layout.ts` | `seedLayout(snapshot): MapPosition[]`. Deterministic, id-ordered (same snapshot ⇒ identical coords, no reshuffle between renders). Port the ring math described in `demoMap.ts`'s header: groups anchored on a circle, teams ringed around their group, people ringed around their home team. |
| `graph.ts` | `buildMapGraph(snapshot, positions): MapGraph`. Resolves home team (majority seat ≥60%, else the **cross-cutting** bucket), delivery edges from `assignments`, reporting edges from `people.managerId`, per-unit stats by reusing `computeRollup` / `computeGaps` / `allocationByPerson`. |
| `palette.ts` | The paper colour table, JS values (lift `C` from `CanvasMap.tsx`). Canvas cannot read CSS vars — this is the JS bridge V2.md calls for. |
| `__tests__/` | `layout.test.ts` (determinism, no NaN, no overlap at seed) + `graph.test.ts` (cross-cutting bucketing, numeric coercion, edge counts). House pattern — Vitest, pure fixtures. |

**Trap — numerics are strings.** Drizzle maps `numeric` to `string | null`, so `person.costPerMonth`,
`orgUnit.costPerMonth` and `orgUnit.expectedRoi` arrive as strings (see `fmtMoney` in `RadialOrg.tsx`).
The lab's `demoMap` uses `number`. **Coerce in `graph.ts`**, once, or every downstream sum is `"1200015500"`.

**Schema — `lib/db/schema.ts`**

```ts
export const mapNodeKind = pgEnum("map_node_kind", ["unit", "person"]);

export const mapNodes = pgTable("map_nodes", {
  id:          uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  boardId:     text("board_id").notNull().default("default"),
  nodeKind:    mapNodeKind("node_kind").notNull(),
  nodeId:      uuid("node_id").notNull(),   // people.id | org_units.id — polymorphic, no FK
  x:           doublePrecision("x").notNull(),
  y:           doublePrecision("y").notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("map_nodes_unique").on(t.workspaceId, t.boardId, t.nodeKind, t.nodeId),
  index("map_nodes_board_idx").on(t.workspaceId, t.boardId),
]);
```

- `boardId` is **text, not a FK** — a `map_boards` table can land later when saved scenarios need it (S6+).
  Costs nothing now and means multi-board doesn't require reshaping rows.
- **Trap — polymorphic `nodeId` has no FK, so deleting a person or unit leaves an orphan row.** Add the
  cleanup to `deletePerson` / `deleteOrgUnit` in `lib/data/actions.ts` **in this story**. It is invisible
  until a deleted person's ghost position collides with a new hire's.
- Generate with `npm run db:generate`, apply with `npm run db:migrate`.

**Data access**
- `lib/data/queries.ts` → `getMapPositions(boardId = "default"): Promise<MapPosition[]>`, workspace-scoped
  via `requireWorkspace()` like every other read.
- `lib/data/actions.ts` → `saveMapPositions(positions, boardId)`. Batch upsert on the unique index
  (`onConflictDoUpdate`), Zod-validated in `lib/validation.ts`, `assertSameWorkspace`.

**Done when:** `npx tsc --noEmit` clean · `npm test` green including the two new suites · migration applied
locally · `getMapPositions()` returns `[]` on a fresh workspace without throwing.

---

## S2 · `v2-canvas-viewport` — real data on canvas, behind `?view=canvas`

**Two files, not one.** Konva needs `ssr: false`, and Next 16 requires that dynamic import to live inside a
Client Component. The lab already hit this (see LAB.md registry) — mirror it:

- `components/viz/OrgCanvas.tsx` — client shell, `dynamic(() => import("./OrgCanvasStage"), { ssr: false })`
- `components/viz/OrgCanvasStage.tsx` — the Konva `Stage`/`Layer` work

**`app/(app)/org/page.tsx`** — read `searchParams.view`; when `"canvas"`, also `await getMapPositions()` and
render `OrgCanvas`, otherwise `RadialOrg` unchanged. Keep the empty-org branch as-is.

**Port from `app/lab/canvas/CanvasMap.tsx`** (it is a source, not an import — labs must not be imported from
production per LAB.md): the four-rung ladder (`lodFor`, `MIN_SCALE`/`MAX_SCALE`, `LOD_LABELS`), pan / pinch /
wheel, the ResizeObserver sizing, node drag, hover bubble, group hulls. Swap `demoMap` imports for a
`MapGraph` prop from `buildMapGraph`.

**Panels — start the extraction now.** `UnitPanel` already takes plain data (`OrgUnit`, `Assignment[]`,
`Person | null`) and lifts out unchanged. `PersonPanel` takes `NodeDatum`, which is radial-layout-specific —
**refactor its props to `{ person, assignment, isOpenRole, teamCount }`** so both renderers can use it. Move
both (plus `Row`, `fmtMoney`) to `components/viz/panels/`. This is step one of S5; doing it here means S2 and
S5 don't both rewrite the same code.

**Drag → persist.** Optimistic local state is authoritative during the session; on drag end, debounce ~400ms
and batch-`saveMapPositions`. Group drag moves the group and its children together (Nate's decision: groups
are placeable, with centroid fallback).

**Palette:** paper only, from `lib/map/palette.ts`. `PaletteSwitcher` is inert on this view until S3 lands.

**Stub the accessible outline here** (a visually-hidden `<ul>` from `orderedUnitTree` in `lib/org/model.ts`),
even if it's crude. Canvas has no DOM; if the outline isn't present from the first commit it will never
feel urgent. Finished properly in S7.

**Done when:** `/org?view=canvas` renders the seeded workspace at all four rungs · a dragged node survives a
reload · clicking a person or team opens the shared panel · Nate eyeballs it.

---

## S3 · `v2-paper-shell` — the whole app goes light *(parallelizable with S1/S2)*

Decision 2026-08-25: the paper register is not just the map's theme, it's Zenhance's. This settles the
"Mini Metro theme" story in ROADMAP.

- **`app/globals.css`** — light default in `:root`; remove or invert the `prefers-color-scheme: dark` flip;
  rewrite the `@theme static` token block to the paper register. **Keep the `@theme static` wrapper** — the
  Lightning-CSS pruning gotcha still applies to any var referenced only from JS/SVG.
- **`lib/theme.ts`** — palettes become **accents over a shared paper base**, not whole themes. Add `paper`
  as `DEFAULT_PALETTE`; decide whether cosmic/forest/crimson/ocean/ember survive as accent hues or retire.
- **Re-skin** `app/(app)/layout.tsx`, `OnboardingBanner`, `PaletteSwitcher`, `PeopleManager`,
  `TeamsManager`, `ImportWizard`, the org empty state, `error.tsx` / `not-found.tsx`. Every
  `bg-slate-900` / `border-slate-700` / `text-slate-400` needs a pass.
- **`FindingsRail` carries hardcoded dark hex** (`#1d2740`, `rgba(14,20,36,.6)`) inline — those must become
  tokens or the rail stays a dark island on a light page.
- **Marketing** (`app/(marketing)/*`, `components/marketing/OrgMockup.tsx`) — reasonable to defer to S5,
  since `OrgMockup` illustrates the radial view we're retiring and needs replacing anyway. Say which you chose
  in the commit; don't leave it ambiguous.

**Done when:** no dark-only hardcodes remain under `app/(app)` and `components/` (excluding marketing if
deferred) · text contrast checked · Nate eyeballs it.

---

## S4 · `v2-canvas-parity` — port the analytics, then flip the default

Cheapest first, so each commit is demo-able:

1. **Findings rail** — the component is already renderer-agnostic. What's new is the canvas side of the
   interaction: ambient = presence dots (category colour, **equal weight, no severity**), focus = spotlight +
   Signal→Narrative card. See PRODUCT.md § Analytics design language; the lab's halo is the same primitive.
2. **Overlays** — `getOverlayProps` in `RadialOrg.tsx` is SVG-coupled. **Extract the math** to
   `lib/map/overlays.ts` returning `Map<nodeId, { dim, badge, heat }>`, consumed by both renderers. Pure,
   testable, and it shrinks RadialOrg ahead of S5.
3. **Search with an additive halo** — the lab already does this. Carries the ROADMAP learning that
   dim-only was illegible on a touch glance; do **not** rebuild dim-only.
4. **Scenario mode + drag-to-reassign** — wire the lab's drop-a-person-on-a-squad to `moveAssignment` and the
   existing in-memory `moves` overlay. ⚠️ **Resolve first:** free drag means *reposition*, but drop-onto-a-squad
   means *reassign* — the same gesture. Proposal: dropping inside a squad's hull reassigns and snaps to that
   squad's ring; dropping anywhere else repositions; scenario mode makes reassignment non-destructive. Undo,
   as the lab has it.
5. **Flip the default.** Canvas at `/org`; `?view=radial` keeps the old one alive for one release.
   **Bump to 0.2.0.**

---

## S5 · `v2-radial-retire` — delete the view, keep the layout

Decision 2026-08-25: radial does **not** survive as a peer view. It becomes a layout command.

- Extract what's still shared out of `RadialOrg.tsx`: `SummaryBar`, `Metric`, `OVERLAY_OPTIONS` →
  `components/viz/panels/`.
- **`lib/map/tidyUp.ts`** — keep `d3-hierarchy`: `tidyUp(snapshot): MapPosition[]` computes the radial tree
  layout and **writes** `map_nodes`. ⚠️ **V2.md open question still unanswered:** does Tidy up replace
  deliberately-arranged positions outright, or preview first? Proposal: write immediately with a single-level
  Undo (matches the lab's move-undo, and a preview mode is a lot of UI for a rare command).
- Delete `components/viz/RadialOrg.tsx` (~1760 lines) and the `?view=radial` branch.
- **Prune deps:** `d3-zoom`, `d3-selection`, `d3-transition`, `d3-drag`, `d3-shape` and their `@types` should
  all become unused. `d3-hierarchy` stays for `tidyUp`. Verify with a grep before removing.
- Archive `app/lab/canvas/` → `app/lab/_archive/canvas/` and record the verdict in the LAB.md registry.
- Replace `components/marketing/OrgMockup.tsx` with a paper/canvas-flavoured illustration — the marketing
  site currently sells a view that no longer exists.
- **Rewrite the `RadialOrg.tsx` region table in CODEMAP.md** with an `OrgCanvasStage.tsx` one. Its line
  numbers are already stale (the table stops at 1410; the file is 1760 lines).

---

## S6 · `v2-zones-layers` — the capabilities canvas unlocks

- **Zones.** `map_zones` (`workspace_id, board_id, x, y, w, h, label, created_at`). ⚠️ **V2.md open question:**
  persist or stay ephemeral? Proposal: **persist** — the readout (people / squads / FTE / monthly cost /
  over-allocated / open roles inside the box) is an analytic worth naming and keeping ("the Atlas cutover").
  An ephemeral marquee selection is a *different* gesture and can coexist.
- **Delivery vs reporting layer toggles** — closes the Backlog's "edge-type layer toggles" story. Already
  working in the lab.
- **On-map inline editing** — `updatePerson` / `updateOrgUnit` actions already exist; this is UI only.
- **Place-new-node tools, snap-to-grid.**

---

## S7 · `v2-touch-a11y` — the iPad bar

- Detail panel → **bottom sheet under `lg`**, ≥44px touch targets, SummaryBar pills wrap.
- **Finish the accessible outline** stubbed in S2: a keyboard-navigable, screen-reader-visible tree from
  `orderedUnitTree(units)`, synced with canvas selection both ways. Canvas has no DOM — this *is* the
  accessibility surface, and V2.md flags it as the thing that regresses unless designed for.

---

## Roadmap stories that are independent of v2

These don't block and don't get blocked; slot them between v2 stories when a session is short.

| Story | Note |
|---|---|
| Burnout risk overlay | `person.lastVacationAt` + tenure. After S4's `lib/map/overlays.ts` extraction it's a pure-function add. |
| Structured roles / job function | Still needs the design discussion in ROADMAP. Unlocks role-coverage gaps and better search. |
| User-defined custom fields | Touches schema + import mapping + panels. |
| Sub-groups (teams-of-teams) | ⚠️ The four-rung ladder assumes exactly group→team→person. Deeper nesting needs a rung policy — recommend binding rungs to *tree role* (leaf unit = "squad", top-level ancestor = "train") rather than to literal depth, so N levels degrade gracefully. Decide before seeding nested demo data. |
| Lifecycle status (active/on-hold) | Unblocks the scrapped search/filter story. |
| Scenario save / compare | This is what `map_nodes.boardId` was left flexible for. |
| Empty / error state audit | Quick; fold into S3's re-skin. |

## Standing traps (all stories)

1. **Tenancy** — every read and write through `requireWorkspace()`, scoped by `workspace_id`. `map_nodes` and
   `map_zones` are no exception.
2. **Tailwind v4 var pruning** — vars referenced only from JS/SVG get tree-shaken and render black. Keep them
   in `@theme static`. The canvas sidesteps this by using a JS palette table; the shell does not.
3. **Konva + SSR** — always the two-file dynamic-import shell.
4. **Numerics are strings** — coerce once in `lib/map/graph.ts`.
5. **Labs are not importable** — port code out of `app/lab/canvas`, never `import` from it.
6. **Analytics stay pure** — `lib/analytics/*` and `lib/map/{layout,graph,overlays}.ts` have no React and no
   DB; add a Vitest fixture whenever the math changes.
7. **Verification** — `npx tsc --noEmit` + `npm test` are the gate. Nate eyeballs UI himself; no
   preview-screenshot loops.
