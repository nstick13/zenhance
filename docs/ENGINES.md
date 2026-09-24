# The six engines

The map is one product, but it is six separable machines. This file names them,
says which files each one owns, and fixes the rule that keeps them apart. It is
the contract `lib/__tests__/engineBoundaries.test.ts` enforces — if you move a
file or add an import, that test is what will tell you off.

Greg named these on 2026-09-24. The names are his, and they are the names we
use in conversation, in commits, and in code.

| # | Engine | The one question it answers |
|---|---|---|
| 1 | **Layout** | Where does every node sit? |
| 2 | **Growth** | How does someone add, merge or re-parent a node? |
| 3 | **Work** | How is work shown at a human level? |
| 4 | **Signal** | What is a node telling you? (team health, the health rings) |
| 5 | **Camera** | What happens when you pan, zoom or focus? |
| 6 | **Basket** | How do you carry a node a long way? |

## The rule

Dependencies run one way only:

```
layout  →  camera  →  runtime  →  { growth, basket, signal, work }
```

An engine may import from anything to its **left**. It may never import from
anything to its right, and never from a sibling in the braces. `runtime` is the
seventh thing — not an engine, the floor they all stand on: the frame loop,
picking, motion, presence and the mark budget.

Two consequences worth saying out loud:

- **Growth, Basket, Signal and Work must not import each other.** When two of
  them need the same fact, that fact belongs in `layout`, `camera` or `runtime`.
- **Nothing below `runtime` may import React or Konva.** The bar for "isolated"
  is the one `lib/orbital/` already meets: drivable in a test with no React, no
  Konva, and no database. That property is why the pure layer has 493 passing
  tests and the renderer has almost none.

## Where each engine lives today

Physical moves into `lib/map/<engine>/` are Phase 2 (see *Status* below). Today
the engines are *groupings of existing files*, and the boundary test knows the
grouping. Read this column as "these files are that engine", not as a path.

### 1. Layout — where every node sits
`lib/orbital/` `geometry.ts` · `layout.ts` · `branches.ts` · `complexity.ts` ·
`forest.ts` · `position.ts` · `envelope.ts` · `size.ts` · `model.ts` · `snap.ts`

~2,400 lines, pure, well tested. **This engine is already isolated** — it is the
model the other five are being moved toward. Its contract is
[LAYOUT-ENGINE-PROMPT.md](LAYOUT-ENGINE-PROMPT.md) and its laws are held by
`lib/orbital/__tests__/laws.test.ts`.

Still trapped in `OrbitalMap.tsx`: ~80 lines of scene assembly (`masterScene`,
`projectedScene`, `interactionScene`, `envelope`).

### 2. Growth — adding, merging, re-parenting
`lib/orbital/insertion.ts` (landing + who makes room) · `relationship.ts`
(harmless move vs. relationship change, magnetic merge, cycle guards, proposal
copy) · `app/lab/grow/` (`GrowLab.tsx`, `visualRules.ts` — **the creation half**)

Still trapped in `OrbitalMap.tsx`: ~465 lines — `onUnitDragStart/Move/End`,
`deliberateTarget`, `unitRelationshipTargets`, `commitPlan`, `onSeatDrag*`,
`confirmMove`, `confirmReparent`.

**This engine exists twice.** The shipped Konva map can rearrange but cannot
create; `GrowLab.tsx` (3,320 lines of SVG) can create but is a lab. Converging
them is Phase 3, and it is the only way the grow flow reaches a customer.

### 3. Work — work at a human level ✅ **extracted 2026-09-24**
**Pure:** `lib/map/work/board.ts` — what a board summarises to, what counts as
in flight, the column split, which teams a board is flavoured with, and the
all-or-nothing rule for sample work. 16 tests.
**Also work:** `components/viz/PersonTaskBoard.tsx` · `render.ts`
`paintWorkCapsules` / `paintWorkDots` · `theme.ts` `WORK_STATUS_FILL`.

**Not work, deliberately:** the work *dimensions* (`WORK_CAPSULE_*`,
`SEAT_RING_STEP`) stay in `lib/orbital/geometry.ts`. Layout has to reserve
room for a person's furniture before anything is drawn — a ring whose spacing
ignored the capsules would overlap them. Those are layout's numbers; work
reads them.

**Known gap:** the data is invented throughout (`lib/mock/personTasks.ts`).
There is no tracker integration, and the UI says so on every panel.

### 4. Signal — what a node is telling you ✅ **extracted 2026-09-24**
**Pure:** `lib/map/signal/progress.ts` (the arithmetic — ratios, wellbeing
thresholds, nullable source-backed rings) · `rings.ts` (the gathering — which
people a unit speaks for, and which numbers are allowed to exist). 38 tests.
**Also signal:** `theme.ts` `healthColor` · `render.ts` `paintUnitRings` /
`paintSeatRings`.

Still in `OrbitalMap.tsx`: the card UI — `OrbitalUnitCard`,
`OrbitalHoverCard`, `Meter` (~310 lines). Presentational, and it moves with
the rest of the component's chrome rather than on its own.

**How Work and Signal were split.** `progress.ts` used to serve both, which
would have been a sibling import. The line is Greg's own wording: Work is
*how work is displayed at a human level* — capsules, dots, the board. Signal
is *what information a node should show* — and that includes its delivery and
sprint rings, because those are the node speaking, not the work. Both read
`lib/mock/personTasks`, which sits below them, so neither imports the other.

### 5. Camera — pan, zoom, focus ✅ **extracted 2026-09-24**
**Pure:** `lib/map/camera/viewport.ts` (fits, cull box, wheel zoom, easing,
the zoom floor) · `focusStack.ts` (the focus stack and the breadcrumb rule).
47 tests, no React, no Konva.
**Glue:** `components/viz/orbital/useCamera.ts` — the stage, the size, the
animation frame, and the one clamped write to Konva. It returns *functions*,
never raw refs: handing a ref out for outside mutation makes the component's
lifecycle impossible to reason about, and the React compiler rejects it.
**Also camera:** `lib/orbital/focus.ts` (scene projection) · `lod.ts` ·
`detail.ts` · `complexity.ts` `fitScaleFor` / `sceneBounds`.

**Still in `OrbitalMap.tsx`: focus *policy*.** Which unit to focus, and what
to frame when you do, needs the scene and the tree — `enterFocus`,
`leaveFocus`, `focusFromBreadcrumb` and the pending-camera effect. They are
now thin, and call the engine for every number. Finishing them means deciding
where "frame this unit plus two rungs" belongs; it is a layout question
wearing camera clothes, and it can wait for the layout move.

`lod.ts` and `detail.ts` sit here rather than in Signal because zoom and the
pinned field are their only inputs. Signal and Work *read* them.

### 6. Basket — carrying a node a long way ✅ **extracted 2026-09-24**
**Pure:** `lib/map/basket/basket.ts` (what may be carried — a unit travels
with its branch, an ancestor absorbs its descendants, the company refuses) ·
`tray.ts` (the tray hit test with its thumb-sized slack, tap-versus-drag, the
carried-branch walk, and the sentence said for each of the five outcomes).
28 tests.
**Glue:** `components/viz/orbital/useBasket.ts` — the tray, the flash timer,
the press handlers.

**The seam with Growth.** Dragging an entry out ends in an ordinary drop, and
a drop is growth's business. Basket and Growth are siblings, so neither may
import the other. `useBasket` therefore reports *intent* —
`beginCarryDrag` / `onCarryMove` / `endCarryDrag` / `locate` — and the map
wires those to the drag machinery. Those four callbacks are the join, and
when growth is extracted they move into `runtime` instead of the component.
This is the shape every remaining extraction should copy.

### 0. Runtime — the floor
`lib/orbital/motion.ts` (springs) · `visibility.ts` (mark budget + thinning) ·
`components/viz/orbital/render.ts` (per-frame painters) · `theme.ts` ·
`SeatAvatar.tsx` · `lib/orbital/avatar.ts`

Still trapped in `OrbitalMap.tsx`: the **270-line frame loop**, `hitTest`,
`buildTargets`, `presenceOf`, `drawnOf`, `detailFor`, `registerNode`.

## The knot, stated plainly

`components/viz/orbital/OrbitalMap.tsx` is **3,687 lines** holding **54 refs,
22 states, 30 memos, 43 callbacks and 25 effects** — down from 3,869 / 59 / 25 /
31 / 50 / 29 before the camera came out. One `useEffect` — the frame loop — is
270 lines and touches **33 different refs** spanning all six engines.

That single function is the reason the engines are hard to separate. It is not
an accident and it should not be naively distributed: a per-frame loop that
reads one object is fast, and six hooks each doing their own pass is not. On an
entry-level iPad from five years ago that difference is the whole product.

**So the frame loop stays whole, in `runtime`.** It is the one place allowed to
touch every engine. Each engine hands it a small read-only "what to paint this
frame" object and never reaches back in. Every extraction in Phase 2 has to
decide who owns each of those 33 refs; that decision is where the bugs will be,
and it is worth doing slowly.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Reconcile the repo — one trunk, branches archived, dead maps retired | **done** 2026-09-24 |
| 1 | Name the seams; enforce them with a test | **done** 2026-09-24 |
| 2 | Extract engines, in order: camera → basket → work → signal → growth → layout | **camera, basket, work, signal done** 2026-09-24; growth next |
| 3 | Converge `GrowLab` into the Growth engine; retire the SVG duplicate | not started |

**Camera, as built (2026-09-24):** `OrbitalMap.tsx` 3,869 → 3,687 lines; 182
lines of braided camera code became 239 lines of glue plus 239 lines of pure,
tested engine. Not a saving in lines, and it was not meant to be — the point
is that a fit, a wheel zoom and the breadcrumb rule can now be checked in
milliseconds instead of by opening a browser and squinting. Two duplicated
bounds reduces and four hand-rolled centre-on-a-point cameras collapsed into
`boundsOfUnits` and `centreOn`.

Phase 2's order is deliberate. **Camera** first: most self-contained, mutates no
org data, and everything depends on it. **Basket** second: smallest complete
engine, so the pattern is proved cheaply. **Growth** late: biggest, riskiest, and
it needs the other five steady underneath it. **Layout** last only because it is
already done — what remains is a move, not a refactor.

One engine per branch, squash-merged to `next`. The map must never be broken for
longer than a single merge.

## Currently unreferenced, kept on purpose

Retiring the Canvas and Radial maps (2026-09-24) left these pure modules with no
caller. They are kept because they are small, tested, and name things the
roadmap still wants — not because anyone forgot them. **If you are about to
build money flow, findings or the lens into the orbital map, start here.**

- `lib/canvas/myView.ts` — "my view" filtering
- `lib/canvas/moneyFlow.ts` · `allocationFlow.ts` · `lineRouting.ts` — the
  money-flow overlay's maths, orphaned when `MoneyFlow.tsx` went
- `lib/analytics/findings.ts` · `allocation.ts` · `gaps.ts` · `rollup.ts` — the
  findings rail's maths, orphaned when `RadialOrg.tsx` went

`lib/analytics/findingsPolicy.ts` is **not** in this list: the settings UI and
the `findings_policy` table still use it.

Revisit this list at the analytics design pass. Deleting any of it is fine — it
is all in git — but it should be a decision, not a drift.

## Getting retired work back

Nothing from the 2026-09-24 clean-up was lost. Every deleted branch tip is a tag:

```bash
git tag -l 'archive/*'
git show archive/<branch-name>
git checkout -b recover archive/<branch-name>
```

`archive/wip/*` tags are snapshots of **uncommitted** work found in three stale
worktrees, captured before those worktrees were retired. The largest,
`archive/wip/codex-fd1e-orbital-map`, holds 39 files and 5,993 insertions — an
earlier state of the large-company-navigation work that is now on `next` in a
later form. Kept in case something was dropped along the way.

The two retired maps live in the history of `next`:

```bash
git log --oneline --diff-filter=D -- components/viz/OrgCanvas.tsx
git show e0d2e5c^:components/viz/OrgCanvas.tsx
git show e0d2e5c^:components/viz/RadialOrg.tsx
```
