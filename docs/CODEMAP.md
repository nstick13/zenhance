# Codebase map

Find the file (and region) that owns your concern, read **only** that, then `grep -n` the symbol and `Read` with `offset`/`limit`. Line numbers drift — treat them as "jump near here," and re-grep to confirm. Whole-file reads are occasionally right, but justify it from this map first.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 · Drizzle ORM over Postgres (`postgres.js`) · Clerk auth (dev-auth bypass locally) · D3 (`d3-hierarchy/shape/zoom/selection/transition`) + SVG for the shipped viz · Konva + react-konva for the v2 canvas map (see [V2.md](V2.md)) · SheetJS + Zod for import. Deployed on Vercel + Neon.

## "Which file do I touch?" — by concern

| I'm working on… | Go to |
|---|---|
| **v2 canvas map (direction, staged plan, architecture impact)** | **[V2.md](V2.md)** — read before touching the viz |
| v2 canvas feel study | `app/lab/canvas/` (`page.tsx` shell + `CanvasMap.tsx` + generated `demoMap.ts`) |
| **Blank-canvas start** (grow an org one node at a time; the team appears rather than being declared) — 🔶 **on `merge/grow-looks-like-org`, not this integration branch or `main`** | `app/lab/grow/GrowLab.tsx` — shared SVG feel-study engine with zoom/pan and in-memory creation; thin `page.tsx` route. `app/lab/grow-established/fixture.ts` supplies an invented 45-person fixture; `/grow-established` aliases the lab route for review. No DB. Integration decisions and unfinished seams: [UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md); study history: [LAB.md](LAB.md) § `grow` |
| **Team memberships (add / edit % / remove)** | `OrgCanvas.tsx` — `Assignments` panel component; `createAssignment`/`updateAssignment`/`deleteAssignment` in `lib/data/actions.ts`; Option-drag branch in `onNodeDragEnd` |
| **Person attributes (discipline / employment / location / timezone)** | `lib/db/schema.ts` `disciplines` + `people`; edit UI in `OrgCanvas.tsx` `PersonForm`/`PersonBody` and `components/people/PeopleManager.tsx`. Discipline find-or-create now lives *inside the import transaction* (`lib/data/importCommit.ts`), not as a standalone action |
| **The lens — what colour/label mean on the map** | `lib/canvas/lens.ts` (pure: `personColor`, `personLabel`, `buildLegend`, `normalizeLens`) + `LensChoice`/`S.lensPanel` in `OrgCanvas.tsx`; persisted via `saveLens` in `lib/data/actions.ts` → `workspaces.lens` jsonb |
| **Paper palette tokens for non-canvas pages** | `app/globals.css` `@theme static` — `--color-paper|surface|ink|ink-soft|line|grow|alert` |
| **v2 canvas look & feel** (stream identity hues, stream header block, intro choreography, open-on-a-view) | `OrgCanvas.tsx` — `STREAM_HUES`/`hueOf`, hull render block, `introT` + `phase()`, `frameBox` |
| **v2 canvas data transform** (flat node list, cross-cutting tier classification, ring layout seed) | `lib/canvas/buildCanvasMap.ts` — `crossCuttingTier` on `CanvasPerson`; gap-based `ghostSeats` memo + ghost render block in `OrgCanvas.tsx`; `sharedPeople` memo + `S.rail` chips for the top rail |
| **Orbital map** — **the default `/org` view** since 2026-09-13 | **Engine is pure and tested: `lib/orbital/`** — `geometry.ts` (radius = depth, angle = parent; ring packing, sector subdivision, `relaxAngles`, the work dot grid + capsule sizing), `model.ts` (snapshot → tree of units + seats; leads become seats, pass-through root merged unless disabled, `applyOverrides`), `layout.ts` (recursive local descent), `forest.ts` (separate real roots + family boundaries, no false central link), `snap.ts` (family-local rung snapping), `lod.ts` (continuous reveal), `progress.ts` (nullable source-backed rings), `motion.ts` (springs). Renderer: `components/viz/orbital/` — `OrbitalMap.tsx` (camera, drag, state), `render.ts` (per-frame painters), `theme.ts`, `OrbitalMapLoader.tsx` (Konva needs `ssr: false`). See [UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md) for current branch limits. |
| **The zoom ladder** (what appears when) | `lib/orbital/lod.ts` is the single source: the central node's progress rings always show, deeper rings ease in by reporting depth via `unitRingReveal`; unit names appear inside sufficiently large circles from `0.7x`, otherwise in hover/tap detail. Human names are always in hover/tap detail, not on-map. `1–1.75x` brings the torus standing in for the crowd · `1.75x+` people + work capsules · `3.5x+` individual work items. Apart from the `0.7x` unit-label gate, figures are continuous 0→1 curves from live stage scale, so detail morphs. |
| **Orbital backdrop and avatar look** | `OrbitalMap.tsx` draws each family's outer boundary, plus three inner helpers while that family is focused; real local snap rungs remain in `family.bands` but need not be drawn. The older filled `band.outer` fields remain in the model but no longer paint. `render.ts` owns the Fitness-inspired progress-ring geometry and shadows; `theme.ts` owns the cool blue/purple/cyan palette. `SeatAvatar.tsx` uses `people.photoUrl` where supplied and deterministic illustrated faces otherwise. The invisible seat hit circle in `OrbitalMap.tsx` is intentional: it makes the avatar tap/hover target work without dozens of hit shapes. |
| **Hovering things that aren't Konva nodes** | Unit circles, work items, progress rings and the torus are *painted*, not noded — several hundred dots would be several hundred nodes. `hitTest` in `OrbitalMap.tsx` finds them arithmetically from the same geometry the painters use (`ringGeometry` is shared by both, deliberately). Clicking a work item opens the right-hand panel and from there `PersonTaskBoard` |
| **The focus path** | Click any unit beyond the company and every unit from the centre out to it gets a heavier outline (thickest on the one clicked) with a heavier line between them; click the company or open paper to let go. State is `focusedUnitId` in `OrbitalMap.tsx`, mirrored into `focusUnitRef` so the painters read it every frame; `paintUnitDiscs` / `paintUnitLinks` in `render.ts` do the drawing, with a screen-pixel floor so the route stays visible fully zoomed out on a 2,500-person org. Unit groups carry `dragDistance={4}` — without it Konva turns a jittery click into a zero-length drag and the click is lost |
| **How big a node draws** | Two separate things. *World size* is `layout.ts`: each rung's node radius is indexed to that rung's fitted gap and arc slot, capped so it never outgrows the rung inside it — it must be measured against the **fitted** bands, and there is a test for that (indexing the unfitted ones made the whole pass dead code). *Screen size* is `lod.ts` `drawnUnitRadius`: zoomed out, a node claims a minimum size **in pixels** that shrinks with depth, so central nodes stay legible while deep teams sit as specks. `PlacedUnit.drawCeiling` bounds it to the rung's radial room. `render.ts` `unitDrawRadius` applies a 0.9 visual reduction; the seat orbit and structural snap radius stay unchanged. Everything that draws or hit-tests a unit uses this wrapper. |
| **Switching company** | The header's name is a switcher (`components/WorkspaceSwitcher.tsx` → `switchWorkspace` action). The choice lives in the `zenhance_workspace` cookie and is **validated against the user's memberships** in `lib/auth/workspace.ts` — the cookie is a preference, never a capability, so a forged one can't reach another tenant |
| **How the rungs get their spacing** (read before touching `layout.ts`) | Three rules, in order. (1) A rung only has to *clear* the rung inside it — `sizeBands`. (2) Every unit's **angular need** is measured in radians against the rung it stands on (`measureNeeds`): a team at CEO+2 costs several times the angle of one at CEO+10, because arc = radius × angle. Counting teams instead is what made a ragged org's radii explode. (3) If the centre needs more than a full circle, the whole map is **scaled** until it fits — which keeps the rungs' relative spacing instead of letting the outermost run away. Sectors are then sliced by that same need, sized to what a family actually needs and centred on its parent, so surplus is left *empty* — that is where "tight clusters, wide gaps" comes from |
| **Demo companies** | `npm run db:companies` (`lib/db/companies.ts`) seeds **Sparrow Jam Manufacturing, OH** (10 people). The ~2,500-person Northwind demo workspace and its rows were removed from the **local development database** on 2026-09-20; its seeding path and switcher exclusion are gone too. Its *generator* survives only as a test fixture at `lib/orbital/__tests__/fixtures/deepOrg.ts`, because it is the one thing proving the layout holds at that size. Visual work happens on Sparrow and the 45-person Digital Tailoring demo. Production data was not checked or changed as part of this cleanup. |
| **Saved orbital arrangement** | `orbital_nodes` table (migration 0008) + `saveOrbitalNodes`/`clearOrbitalNodes` in `lib/data/actions.ts`, `getOrbitalNodes` in `queries.ts`. `parent_id` there is an **arrangement override, not an org edit** — `org_units.parent_id` is never touched by a drag, so rearranging the map can't restructure the company by accident |
| **Orbits / whiteboard mode** | `components/viz/orbital/OrbitalMap.tsx` owns the Break orbits and Tidy up controls, snapped versus free drag, and session-only placement offsets; `lib/orbital/position.ts` also turns saved angles into branch-local offsets so moving one branch does not repack unrelated siblings. Tidy up clears both local offsets and saved `orbital_nodes` arrangement rows, then returns to calculated Orbits. See `docs/ORBITAL-INTERACTION.md` for the current decision. |
| Greg's original prototype (the v2 trigger) | `docs/reference/greg-preview-v1.html` — see `docs/reference/README.md` |
| The radial visualization (anything on `/org`) | `components/viz/RadialOrg.tsx` — **see region table below** |
| Color palettes / themes | `lib/theme.ts` (palette IDs + accent) **and** `app/globals.css` (the CSS-var blocks per palette). Adding a palette = both files. |
| Analytics math (cost/ROI, gaps, allocation) | `lib/analytics/{rollup,gaps,allocation}.ts` — pure, client-safe, unit-testable |
| Org-tree / allocation helpers (indexes, ancestry, utilization) | `lib/org/model.ts` |
| DB schema / tables / enums | `lib/db/schema.ts` (`workspaces`, `memberships`, `people`, `orgUnits`, `assignments`) |
| DB connection / Drizzle client | `lib/db/client.ts`, `lib/db/orm.ts` |
| Reading data (server) | `lib/data/queries.ts` (`getOrgSnapshot`, `getPeople`, `getOrgUnits`, `getPerson`, `getOrgUnit`) |
| Mutations (server actions) | `lib/data/actions.ts` (create/update/delete person·unit·assignment, `moveOrgUnit`, `moveAssignment`, `loadDemoOrg`) |
| CSV/Excel import | **`lib/data/importCommit.ts` is the engine** (validate + commit; deliberately *not* `"use server"`, so tests can drive the real code); `lib/data/import.ts` is the thin workspace-scoped action over it; `components/import/ImportWizard.tsx` is the UI |
| **Import value normalisation** (employment / timezone / title→discipline) | `lib/data/importMapping.ts` — pure, shared by the wizard's preview and the server commit so both agree by construction. Unit tests `lib/data/__tests__/importMapping.test.ts` |
| Import tests | `lib/data/__tests__/importS2.integration.mts` drives the **real** engine (prefer it as the model). `import.integration.mts` predates the split and re-implements the resolution logic, so it proves nothing about shipped code |
| **Import edge cases / known failure modes** | [docs/reference/import-edge-cases.md](reference/import-edge-cases.md) — the 50-org corpus test: non-ISO dates & `kind` vocab hard-fail, flat dumps lose all structure, `guessColumn` Location→Allocation bug, etc. Read before touching import robustness |
| **Scale fixture + benchmark** | `lib/db/scaleFixture.ts` (`npm run db:scale`, its own workspace — never clobbers the demo org) + `lib/canvas/__tests__/scale.bench.mts` |
| **Analytics/config design proposals** (not built) | `design/*.dc.html` → published canvas, linked from ROADMAP's analytics section |
| Seed / demo data | `lib/db/seed.ts` (CLI `npm run db:seed`), `lib/data/demoSeed.ts` (in-app "Load demo org") |
| Auth / multi-tenant scoping | `lib/auth/workspace.ts` (`requireWorkspace`, `assertSameWorkspace`), `lib/auth/currentUser.ts` (Clerk vs dev-auth) |
| Form/action validation | `lib/validation.ts` (Zod schemas) |
| People / Teams CRUD pages | `components/people/PeopleManager.tsx`, `components/teams/TeamsManager.tsx` (pages are thin: `app/(app)/{people,teams}/page.tsx`) |
| **Workspace settings (S5)** — vocabulary + discipline CRUD | `components/settings/SettingsManager.tsx` (page is thin: `app/(app)/settings/page.tsx`) |
| **Discipline CRUD data work** (create/update/delete-with-reassign/merge/reorder) | `lib/data/disciplineOps.ts` — pure workspace-scoped data ops; `lib/data/actions.ts` wraps them with auth + Zod + revalidate. Integration script: `lib/data/__tests__/disciplines.integration.mts` |
| **What the org calls its two rungs** ("value stream" / "team") | `lib/vocabulary.ts` (pure: `Vocabulary`, `DEFAULT_VOCABULARY`, `PRESETS`, `normalizeVocabulary`, `lower`) → `workspaces.vocabulary` jsonb; handed to the client tree by `components/VocabularyProvider.tsx` (`useVocabulary()`) |
| Routing / auth middleware | `proxy.ts` (Next 16 — **not** `middleware.ts`) |
| App shell / layout / empty-org screen | `app/(app)/layout.tsx`, `app/(app)/org/page.tsx`, `app/(app)/{error,not-found}.tsx` |
| Onboarding banner, palette switcher | `components/OnboardingBanner.tsx`, `components/PaletteSwitcher.tsx` |

## `components/viz/RadialOrg.tsx` region guide (~1400 lines)
One client component. Jump to the region; don't read top-to-bottom.

| Region | ~Lines | What's there |
|---|---|---|
| Imports, `OverlayType` / `NodeDatum` types, geometry consts + `pointRadial`/`arcPath` | 1–65 | Layout constants (`WIDTH/HEIGHT/INNER_RADIUS/DROP_RADIUS`), pure SVG-math helpers |
| Component props + scenario state (`moves`, `effAssignments`) | 67–99 | What-if overlay over assignments |
| Derived indexes & analytics memos | 101–122 | `unitsById`, `peopleById`, `childByParent`, `asgByUnit`, `overAlloc`, `allocByPerson`, `rollupMap`, `gapsMap`, `orgSummary` |
| Focus state (drill-down) | 124–138 | `defaultFocusId`, `focusId`, `selectedPersonKey`, `showPanel` |
| Zoom state + handlers | 140–191 | `d3-zoom` setup, scale extent `[0.3,5]`, dblclick disabled, zoom in/out/reset |
| Drag state | 193–204 | pointer-drag reassignment refs |
| Semantic-zoom (LOD) computation | 206–339 | `DETAIL_START/FULL`, `detailOpacity`, `zoomFocusTeamId`, **bloom sets** `detailMembers` / `detailSubTeams` / `detail2Members` |
| Node/link layout | 213–264 | `hierarchy`/`tree` radial layout → `nodes`, `links` |
| Focus/move/scenario handlers | 426–470 | `focusOn`, `performMove`, `applyScenario`, `discardScenario`, `toggleScenario` |
| Pointer/drag handlers | 472–538 | `clientToLocal`, `beginMemberPointer`, `onSvgPointerMove`, `onSvgPointerUp` |
| **Main JSX return** | 540–955 | `<SummaryBar>`, breadcrumb, scenario controls, `<svg>` defs (gradients/glow/heat), `nodes.map`, the 3 bloom render blocks, drag ghost, zoom controls, detail `<aside>` |
| `onUnitClick` | 957–973 | two-phase center-click (reset zoom → navigate to parent) |
| Overlay prop builder | 985–1043 | `getOverlayProps` + `NodeOverlay` type (per-node dim/badge/heat) |
| Presentational components | 1045–1410 | `ContextSatellite`, `RadarNode` (the node art), `UnitPanel`, `PersonPanel`, `Row`, `OVERLAY_OPTIONS`, `SummaryBar`, `Metric` |

## Conventions worth knowing before you edit
- **Tenancy:** every data read/write goes through `requireWorkspace()` and is scoped by `workspace_id`. Never query unscoped.
- **Analytics are pure functions** in `lib/analytics/*` (no React, no DB) — add a Vitest fixture when you change the math.
- **Tailwind v4 gotcha:** CSS vars referenced only from JS/SVG get tree-shaken by Lightning CSS → blanked gradients. Keep palette tokens inside `@theme static` in `globals.css`. (See memory `zenhance-tailwind-css-var-pruning`.)
- **Run locally:** `brew services start postgresql@14` → `npm run dev` (:3000, dev-auth auto-signs in). `npm run db:seed` to reset to the demo org.
