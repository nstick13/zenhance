# The hex grid study

**In one paragraph.** The map draws a company by putting every team somewhere
on an open plane. That freedom is what makes a big company sprawl: Northwind
is 40,000 by 58,000 units across, and crossing it takes so much zooming that
you pass nothing you can read on the way. This study replaces the open plane
with a **honeycomb** — every team gets one cell of a uniform hexagonal grid,
and its people orbit inside that cell exactly as they do today. The same
company then fits in 8,500 by 8,900, lays out four times faster, and reads as
one continent with coloured regions instead of grey fog. It also found a real
limit: **a hexagon has six sides, so a manager with sixteen reports cannot
have them all next to them**, and on companies shaped like that the design
starts to come apart. That limit, and what to do about it, is the main thing
this study has to say.

Greg asked for it on 2026-09-29. It lives on `lab`, at `/lab/hex`. Nothing
about `/org` has changed.

---

## What Greg asked for

> *"Let's shoot for a hexagon based layout. The base hexagon can be a team —
> because within that base hexagon, human nodes can orbit a parental node
> that's centred on the middle of the hexagon… If a node has six child nodes,
> great — it's a hexagon tessellation. If more, then we can move child nodes to
> 'jump' to the next one, and show a sort of bezier arc back to the parent.
> Furthermore, little islands and whatever can happen more naturally. This is
> much more 'settlers of catan' than I'd first envisioned."*

All of that is built and can be driven.

**It reverses a call he made on 2026-09-13** — *"snapping is relative to parent
orbits, rather than an absolute grid"*, which is the sentence `snap.ts` opens
with. The reason it changed: free placement is what made arrangements look
accidental, and a continuous plane is what let the company sprawl.

## What it measures

Same company (2,562 people, 395 units), same renderer, same colours. Flip
between the two layouts with the **layout** toggle in the panel.

| | orbits (ships today) | hex `roomy` | hex `tight` |
|---|---|---|---|
| across | 40,296 × 58,162 | 12,484 × 12,953 | **8,543 × 8,864** |
| area | 2,343M | 162M | **76M** — 31× smaller |
| layout time | 77ms | 19ms | **8ms** |
| units overlapping | 0 | 0 | 0 |
| people of one unit in another's space | 0 | 0 | 0 |

`roomy` reserves room for each person's work board; `tight` reserves room for
the people only, and lets a work board spill into the neighbouring cell at
1.75× and beyond. The toggle exists because that is not a trade anyone can
settle in prose.

**The lattice gives away three things for free.** Territory is the set of cells
a region occupies, so there is no outline to compute — `envelope.ts` does
smooth-union → marching squares → Chaikin and costs 25–35ms per data change;
here it is a fill. Pointing at a unit is a coordinate conversion rather than a
walk over every unit in view. And two units cannot overlap, so Law 4 stops
being a property to check and becomes one that cannot be violated.

## The limit it found

A hexagon has six neighbours. One is the way home to the parent. **So a unit
can have at most five children next to it** — that is geometry, not tuning.

Until this study, no fixture could show what that costs, because every company
we own is capped at four children anywhere: Northwind, Digital Tailoring and
Sparrow Jam alike. Real orgs are not shaped like that — the practitioner in
[FEEDBACK.md](FEEDBACK.md) ran ninety pods. `buildDeepOrg` now takes a `span`
option so wide companies can be generated; the default is unchanged, so every
measurement previously recorded against that fixture still means what it said.

With that, on a 1,200-person company at increasing width:

| widest span | children sitting next to their parent |
|---|---|
| 4 | **79%** |
| 8 | 47% |
| 16 | 32% |
| 20 | 24% |

**The premise inverts.** At the shape our fixtures have, the jump is a rare
exception and the drawing is a honeycomb. At the shape real companies have,
two children in three are jumps, and the map becomes a thin scatter of nodes
joined by long curves — which is the criss-cross Greg complained about in
September, arrived at from the other direction.

Two ways out, and they are worth deciding between before any more is built:

1. **Make the jump the language, not the exception.** Accept that a wide span
   fans outward over two or three rings and design the arcs to read well —
   nearer to a transit map than a honeycomb.
2. **Give each parent a flower, not a cell.** A parent plus rings 1 and 2 is
   nineteen cells, which seats sixteen children comfortably. Flowers then
   tessellate at the next scale up. This is the hierarchical hex idea (Uber's
   H3 is the well-known version) and it is also what would fix the zoom
   problem below — one lattice per zoom level, so the map stops reserving room
   for people while you are looking at the whole company.

The study's own evidence points at (2). It is a bigger piece of work.

## What it does not fix

**The scale imbalance is untouched, because it was never in the layout.** A
unit's disc is 13.4 units across; a hexagon holding it is 318. The ratio comes
from `geometry.ts` — `SEAT_RING_STEP` is 136 and `UNIT_RADIUS` is 13.4 — so
one team fills the screen at 1.3× and its neighbours are nowhere. Greg's
complaint that *"human nodes are so infinitesimally tiny that the user must
zoom to practically Planck lengths"* is a property of how much room a person
and their work board claim, and moving the units onto a grid does not change
it. It needs its own pass, in `geometry.ts` and `lod.ts`.

**Labels are still thin in the middle of the range.** What rescues the hex map
between 0.05× and 2× is not names, it is **territory colour** — you can see
which region you are in long before you can read it. That turns out to matter
more than expected, and it is the cheapest real improvement in the study.

## Where the engines rub

Greg asked for a log of these. The hex layout emits an ordinary `OrbitalScene`,
so camera, runtime visibility, signal, work and basket consume it unchanged —
that part held. These are the places it did not sit flush.

| # | Where | What rubs | Cost to settle |
|---|---|---|---|
| 1 | `layout.ts` `Geography` | The union is `"orbital" \| "local"`. A hex scene sets neither, so anything testing it reads a hex map as the ring map. | One word in the union, then fix each reader. |
| 2 | `camera/focus.ts` | Branches on `geography === "local"` to decide *not* to re-lay the scene on focus. A hex scene would fall through and be re-laid by `layoutOrbital` — wrong, and it would move the lattice under the viewer. | One line, once (1) exists. **The only rub that would be a visible bug.** |
| 3 | `PlacedUnit` | Carries `angle`, `sector`, `childOrbit`, `outward`, `near` — all polar ideas. Hex fills `sector` with a full circle and leaves the rest undefined. | Harmless today. Honest fix is to split the type. |
| 4 | `lod.neighbourAwareRadius` | Needs `near` to stop dots swelling into each other. Hex leaves it undefined — and does not need it, because the cell already guarantees the gap. | None. The lattice makes an engine function unnecessary. |
| 5 | `OrbitalScene.bands` | Rungs are a ring-map idea. Hex returns `[]`. | None, but it is a field that means nothing here. |
| 6 | `layout/snap.ts`, `growth/insertion.ts`, `layout/position.ts` | Entirely polar: "which rung, which sector, what angle". Hex uses none of them. | These are the ~800 lines a production hex map would replace with cell arithmetic. |
| 7 | `layout/envelope.ts` | Not needed at all — territory is the cells. | None; it becomes dead code on this path. |
| 8 | `orbital_nodes` (database) | Stores `angle` + `distance`. A cell is `(q, r)`. Old placements do not convert. | A migration, and a decision from Greg or Nate about discarding saved arrangements. Note `0009` is still unshipped ([TASKS.md](TASKS.md)). |
| 9 | `lod.unitLabelVisible` | Tuned against orbital sizes; on the hex map a team stays unnamed until about 4×. | Not a hex problem, but the hex map makes it obvious. |

## Open risks

**Stability under edit — the one that would sink it.** The allocation is
recomputed from scratch and is a pure function of the company (proved), but
adding a single unit can displace a chain of neighbours, because on a lattice
there may be no free cell where one is wanted. On the orbital map a new
sibling nudged its neighbours along an orbit. Nothing here holds a previously
placed unit still. **This is not solved and is not attempted**; the study
cannot be dragged, so it never comes up. It has to be answered before any of
this goes near `next`.

**Law 2 changes meaning.** *"A node lands exactly where the hand let go"*
becomes *"a node lands in the cell under the hand"*. I think that is the better
rule — the landing can be shown before release, which is the real cure for the
elastic feel — but it is a change to a written law, not an implementation
detail.

**Allocator tuning is barely explored.** Depth-first with a two-ring lookahead
took adjacency from 7% (breadth-first) to 73%. A sweep of the two constants
was attempted and was defeated by the module cache; the numbers here are from
one configuration, not a best one.

## Recovering what came before

Nothing was deleted. Three ways back, any one of which is enough:
[docs/reference/RECOVERING-THE-ORBITAL-LAYOUT.md](reference/RECOVERING-THE-ORBITAL-LAYOUT.md)
— the working tree still has it, `archive/orbital-layout-pre-hex` tags it, and
`docs/reference/orbital-layout-engine.tar.xz` holds 27 files and 5,810 lines in
73 KB.

## What is where

```
lib/map/layout/hex/
  coords.ts     the lattice: axial coordinates, rings, spirals, cell↔world   ~215 lines
  allocate.ts   which unit gets which cell — the half with an opinion        ~230 lines
  scene.ts      allocation → an ordinary OrbitalScene, people orbiting in it ~230 lines
  __tests__/    30 tests: the lattice, Laws 1 and 4, wide spans, packing
app/lab/hex/
  page.tsx      picks a company, invents it server-side
  HexLab.tsx    a plain 2D canvas driven by the pure camera and LOD engines
```

Deliberately **not** Konva. Part of the point was to show the layout is
isolated: everything that moves comes from `lib/map/camera/` unchanged, and the
renderer under it is four hundred lines of `ctx.arc`. If it only worked inside
`OrbitalMap.tsx` we would not know which of the two was doing the work.

## Verified, and not

**Verified by tests** (30 new, 610 across the suite, all passing): ring and
spiral geometry; cell↔world round-tripping over 841 cells; neighbours exactly
two inradii apart; Law 1 by re-running and by reversing the input order; Law 4
on four company sizes, both densities — every unit in its own cell, no disc
touching another, every person inside their own unit's hexagon; that a chain
grows by its length rather than exponentially; that a parent never seats more
than five children adjacent; and that the packing beats the orbital layout by
more than three times on each axis.

**Verified in a browser** at `/lab/hex`, on all four companies, both densities,
both layouts: whole-company view, the zoom ladder down to individual people,
pan, wheel zoom, fit, hover, and the region colouring. Console clean after the
hydration warning was fixed.

**Not verified:** touch and pinch (the page handles pointer events, but no
real device was used); `prefers-reduced-motion` (there is no motion in the
study); anything on a five-year-old iPad; and frame rate under load — the
browser pane throttles `requestAnimationFrame` when hidden, so the numbers I
could take were meaningless and none are quoted.
