# The hex grid study

**In one paragraph.** The map draws a company by putting every team somewhere
on an open plane. That freedom is what makes a big company sprawl: Northwind
is 40,000 by 58,000 units across, and crossing it takes so much zooming that
you pass nothing you can read on the way. This study replaces the open plane
with a **honeycomb** — every team gets one cell of a uniform hexagonal grid —
and reads as one continent with coloured regions instead of grey fog. It also
found a real limit: **a hexagon has six sides, so a manager with sixteen
reports cannot have them all next to them**, and on companies shaped like that
the design starts to come apart. That limit, and what to do about it, is the
main thing this study has to say.

**Two sentences of that paragraph used to be about size, and they have been
taken out, because they were true of an engine that no longer exists.** The
first layout — the *archipelago* — packed cells tight and fitted the same
company into 8,500 by 8,900, under a ninth of the area. It was also the engine
that produced the confetti, and it was deleted on 2026-10-15. What runs now is
the **atlas**, which reserves ground for a family before it places anybody, and
that ground is what the compactness was paying for:

| Northwind, 2,562 people | across | down | against the orbital layout |
| --- | ---: | ---: | --- |
| the orbital layout | 39,842 | 57,611 | — |
| the archipelago (deleted) | ~8,500 | ~8,900 | about a ninth of the area |
| the atlas, `tight` | 41,397 | 25,939 | about half the area |
| the atlas, `roomy` (the default) | 69,419 | 43,498 | **about a third more area** |

So at the density the lab opens on, the honeycomb now covers *more* ground than
the layout it was meant to replace. That is a real cost against the original
complaint — a big company is still a long way across — and it is the price of
teams that hold together. It is worth revisiting when the layout goes radial,
because a ring layout sets its own extent.

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
| 10 | `lod.REVEAL_BANDS.people` | Reveals people by **world scale**, which only makes sense where a unit's size depends on what it carries. Every hex cell is the same size, so the honest trigger is cell pixels — and the band is three times too deep. The lab overrides it locally rather than retuning a band the orbital map shares. | A second ladder, or a reveal that takes a size rather than a scale. Must be settled before promotion. |
| 11 | `layout.placeUnitSeats` | Sits the first six people *inside* the unit and the rest on circular rings. Both are wrong on a lattice, so the hex path no longer calls it (`hex/people.ts` instead). | None — but it is now the second engine function the lattice replaces rather than reuses, after (4). Worth noticing if that becomes a pattern. |

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

## Arrangement — Greg's rules, 2026-09-30

The study can now be rearranged by hand. Greg's rules and where each one lives:

| Rule | State |
|---|---|
| A child may snap to a **sibling**, not just its parent | **built** — this is the allocator's rule now |
| Connection lines replaced by adjacency + colour | **built** — there are no lines at all in hex mode |
| The route home lights up on demand | **built** — hover or drag a tile |
| Islands need not touch; a sea of empty cells between them | **built** |
| Free movement, snapping to the lattice on release | **built**, with the landing cells lit while the hand moves |
| No tile on top of another; offer the nearest free cell with a warning | **built** — and the cell stays lit while the dialog asks |
| Drop against another family → offer reparent, or leave it adjacent | **built** |
| Islands move as one, reshaping only when they must, and asking first | **built** — one gesture: a tile always travels with its branch |
| Hold over a tile → merge or reparent | **built**; merge itself stays disabled, as on the orbital map |
| A chunky outline round everything meta-connected | **built** — exact on a lattice, and it is what shows an exclave |
| Offer to **de-parent** a tile dragged away from its family | **not built** |
| **Gather** scattered children back to their parent | **not built** |
| Auto-arrange flavours (linear, spiral, geographical, radial) | **not built** |
| Tidy up neatens in place; a second press compresses | **built** — see below |
| Arrangements survive a refresh | **built** — `localStorage`, per company |
| Siblings, parent and children shown on hover | **built** |
| Connection lines routed along the lattice's own angles, chunky and dark | **built** |
| A node inset in its cell, sized by how deep it sits | **built** — a tenth of the cell at the deepest rung |
| Permanent self-coloured chains back to the parent | **built** |
| No borders on the tiles; an occupied cell only a shade darker than the page | **built** |
| The outline wraps the whole branch, or the immediate family for a leaf | **built** — `hoverGroup` |
| **Radiating** — a branch trees itself away from its parent on the second pick-up | **built** — see below |
| A node fills at most 85% of its cell, so there is always a ring to stand on | **built** |
| People orbit the node on hexagonal rings, lead by the connection line | **built** — see below |

**Arrangements persist**, in `localStorage`, per browser and per company — a
lab has no database by house rule, and an arrangement is worth more than the ten
seconds it took to make. Every read and write is wrapped: a private window or
blocked site data throws rather than returning nothing, and an arrangement is
not worth a blank page.

### Seeing the family (2026-09-30, later)

Greg: *"we need some visual rules that help a user see siblings, parents and so
on… when I hover on a tile, its siblings should grow a white border too, and it
should be apparent who the parent tile is."*

Four treatments, in descending weight. Point at a tile and:

| | treatment |
|---|---|
| the tile itself | a white band |
| **its parent** | a heavier white band **and a dark one just inside it** — the one tile in the family you cannot mistake for another |
| its siblings | a thinner white band |
| its children | a thinner white band, **dashed**, so they read as the other direction rather than more of the same |

The tile and its parent also carry their names whatever the zoom, overriding the
usual label rules. Answering *who is the parent* is the point of the gesture,
and a nameless hexagon does not answer it.

### A node is smaller than the cell that holds it (2026-09-30, later)

Greg: *"the visual distinction between peers is not as clear as it could be…
team nodes should be smaller than the hexagonal tile they occupy — an offset
within the boundary of the container hexagon… The master central node should
occupy 100% of the hosting hexagonal area… nodes that stratify between team and
master central should occupy an area that steps up, with each step calculated
based on how many strata there are. Eg: master central: 100%; master central
+1: 75%; team/master central +2: 50%."*

`nodeAreaFraction(depth, maxDepth)` in `scene.ts`: the company keeps all of its
cell, **the deepest rung keeps a tenth of the area** — stepped down from a half to a
quarter to a tenth over one afternoon of Greg looking at it, *"the added
variation in size is helping a lot"* — and the rungs between step evenly, so
the step size follows from how many rungs a company has rather than being a
number anyone tuned. `nodeScale` is the same rule as a *linear* scale, which is
what a radius wants: a tenth of the area is **32%** of the width, not a tenth
of it. Using the area figure as a radius scale would draw a team at one percent
of what was asked for.

**Deferred, and measured so it stays a known quantity.** Greg looked at it on
2026-09-30 and parked it — *"I don't think I mind it right now. It's not
elegant but it's not broken."* What actually happens, on either cell density:

| | holds | people reach | |
|---|---|---|---|
| seat ring 0 | 6 people | 53 out | **inside** the node (87 roomy, 60 tight, edge to centre) |
| seat ring 1 | 22 more | 189 out | outside it |

So it is not that people do not fit — **it is the seventh person onward**. A
team of six or fewer is entirely contained; beyond that the outer ring appears
as an arc sitting outside its own hexagon, which is what Greg photographed on
Pioneer Team 58. Northwind's median team is 8 and its p90 is 14, so most teams
spill two or three and the largest spill a dozen.

That also bounds the fix, whenever it is wanted. Either the first ring has to
hold more than six, or the second ring has to come in much closer —
`SEAT_RING_STEP` is 136 because a second ring must clear the *work capsules* of
the first, and those are not drawn at the zoom where this is visible. It is the
seam between this sizing rule and `geometry.ts`, and whichever is decided second
will have to give.

Two things follow from the gap this opens up:

- **The chains have somewhere to run** (below). Before, a line between two
  touching tiles had nowhere to be seen.
- **The white disc under each unit lost its screen floor.** The orbital map
  holds that disc above a minimum size so a unit is visible when pulled back;
  here the hexagon says a unit is there, so the disc went back to its true size
  and stopped putting a white dot on all 395 tiles at overview.

The territory did not go away — it became a faint wash over the whole cell,
strongest pulled back and fading as the nodes take over. That wash is what made
the mid-zoom band navigable in the first place, and losing it to get the node
sizing would have been a poor trade.

### Chains that are always there

Greg: *"sibling nodes should have self-coloured connection lines that are
permanently visible and chain back to the parent node. These do not do anything
other than indicate 'chain to parent' relationships. The connection lines follow
the same geometry as the hover-state path, but sit behind it on the z axis."*

Every unit draws one line to its parent, in its own colour, along the lattice
angles, under the nodes and under the hover route. Its weight scales with the
node's, so the trunk is thicker than the twigs — which is the one bit of
standing a drawing can still carry once every node is the same shape.

**This is not a return to the connection lines that were removed.** Those ran
tens of thousands of units across the map and crossed territories they had
nothing to do with; these are stubs between touching cells, living in the gap
the node sizing just opened. The exception is an exclave, where the chain is
genuinely long — and that is the case where you want to see it.

### Chains walk round the tiles (2026-10-01)

Greg: *"preference non-overlapping connection lines — either they do not
overlap other connection lines, and where possible connection lines do not run
underneath other nodes except in cases of sibling chaining… we should preserve
how the connection lines emanate from the tiles… we want [hexagon centre point]
to [hexagon side midpoint]."*

**The constraint comes first.** A chain only ever runs centre to side-midpoint —
30°, 90°, 150° and their opposites. Those are the directions to a neighbour, so
a chain is a **walk from cell to cell**, never a line drawn across them. The
attempt on 2026-09-30 to add the centre-to-*vertex* directions measured
beautifully and looked wrong; the angles are not negotiable.

So `route.ts` routes rather than draws: A* across the lattice, where clear
ground is cheap, a stranger's tile is expensive, and a **sibling** is nearly
free — Greg's exemption, and the one case that cannot be designed away, because
past five children somebody has to reach the parent past somebody. Cells already
carrying a chain cost extra, so the second chain through a gap takes the next
one along. Every chain is routed through one `Router`, shallowest first, so the
trunk gets the clear ground and the twigs bend round it.

| on the 2,562-person company | before | after |
|---|---|---|
| chains passing under a stranger | 152 (39%) | **133 (34%)** |
| tiles passed under | 251 | 210 |
| **chains crossing another chain** | **38** | **21** |

Median zero bends, worst three — most chains are unchanged, which is the point.
8ms for 394 chains, once per arrangement.

**The sibling price is the interesting number.** Set high, the router detoured
*around* family to avoid passing under it, and those detours wandered into other
chains — 36 crossings. Priced below a two-cell detour and its two turns, a chain
goes straight through its own family and the crossings fall to 21. Avoiding
siblings was never the point.

### The long straight lines, and what they turned out to be (2026-10-02)

Greg, 2026-10-01: *"routing does not fan out, rather it can bullishly hold to
whatever origin side of its original hexagon it was originally. Perhaps
connection lines are too fixed to a given side of their host hexagon?"*

The observation was right and it was two different things wearing one coat.
Measured on the 1,000-person company:

- **Only 11 parents in 53 give every child a face of its own.** Chains converge
  and arrive together.
- **31% of chains continue their parent's chain along the same axis**, in
  unbroken runs of up to seven nodes. A line through seven nodes reads as one
  bullish line; it is five separate chains that happen to be collinear.

Neither is a routing fault, and the router cannot fix either. **The fix was in
the allocator** — see *the doorstep price* below.

#### The router's fan is not free, at any price

`SIDE_ALREADY_USED` in `route.ts` charges a chain for leaving or arriving on a
face another chain already uses. It works, and it costs more than it buys. On
the 1,000-person company, over the allocator as it now stands:

| price | parents fully fanned | chains 3+ steps | longest chain | under a stranger |
|---|---|---|---|---|
| **0 (shipped)** | 11 / 53 | 25 | 5 | **26** |
| 200 | 13 / 53 | 30 | 5 | 28 |
| 400 | 28 / 53 | 48 | 5 | 66 |
| 800 | 29 / 53 | 48 | 5 | 68 |

The fan doubles and the tangle triples, because **the router has exactly one way
to reach a different face, which is to walk further round.** Nor is any of it
free at the margin: priced at 1, 2, 3 or 5 — small enough to break ties and
nothing else — the fan does not move at all (54 → 53 one-face parents on
Northwind). There are no ties to break.

**So it is off, and left in as one constant.** Set it to 400 to see the fan the
router can buy, and what it costs.

#### Leaning the fan, which made everything worse

If a lineage draws a straight line because `fanAngles` aims the heaviest child
straight along `outward` at every rung, then leaning the fan a lattice step and
alternating by depth should kink it. It does — longest run 7 → 4 — and it costs
adjacency (54% → 49%), exclaves (9 → 10) and chains under strangers (26 → 47),
and *raises* collinearity to 37%. Reverted. A lineage running straight is what
rule 2 asks for; it is not worth a kink bought with a worse map.

### The doorstep price — what did work (2026-10-02)

A unit has six neighbours. One is the way home, so **five of its children can
touch it**, and a child that touches its parent gets a one-step chain, on a face
of its own, crossing nothing. Everything above is downstream of children not
getting those cells.

They were not getting them because nothing stopped **a cousin's subtree, seated
earlier** — the walk is depth-first and heaviest-first — **parking on all five.**
Measured before the change: at the end of allocation there was not one free cell
going spare next to any parent. The ground was gone, taken by units with no claim
on it.

So `DOORSTEP` in `allocate.ts` charges for a cell next to a unit that still has
children to seat, and the charge rises as that unit runs out of room. **It is a
price, not a reservation** — a child with nowhere else to go still takes the
cell. That distinction is the whole reason this is not the fourth of the three
abandoned rewrites in the allocator's header: those partitioned the plane before
anyone sat down, and starved.

| | 1,000 people | | Northwind 2,562 | |
|---|---|---|---|---|
| | before | after | before | after |
| children touching their parent | 44% | **54%** | 46% | **49%** |
| exclaves | 19 | **9** | 48 | **25** |
| families in one patch | 39/58 | **49/58** | 86/131 | **106/131** |
| chains of 3+ steps | 38 | **25** | 90 | **88** |
| **chain passages under a stranger** | 80 | **26** | 214 | **152** |
| map radius (rings) | 13 | **10** | 19 | 19 |

Sparrow Jam and Digital Tailoring were already perfect — 100% touching, zero
exclaves, every chain one step — and are unchanged.

The price was swept at 60, 100, 150, 200, 260 and 400 on both large companies.
**150 wins on nearly every measure on both**, and the curve is not smooth: 200
and above push Northwind's exclaves back up to 42 as families start refusing
ground they should have taken. It is a greedy search, so the surface is bumpy;
do not read the number as a tuned optimum, read it as the one that measured
best.

### What routing cannot fix, and the next lever

**Sweeping every cost — sibling, turn, stranger, detour allowance from 6 to 40 —
changes the stranger figure not at all.** It sits flat however the search is
priced, which means the router is already finding the only paths that exist. The
rest is forced by density, not by choice.

Where it is forced, measured by how far a child sits from its parent:

| distance | chains | still under a stranger |
|---|---|---|
| 1 step | 182 | **0%** |
| 2 steps | 142 | 46% |
| 3+ steps | 70 | ~100% |

**18% of chains caused 69% of the crossings, and they are the long ones.** That
is what the doorstep price acts on, and why it moved the stranger figure by two
thirds when no amount of routing could move it at all.

The next lever after it is **leaving ground to route through**. The allocator
packs families adjacently, so there are no corridors. A layout that reserved
streets the way a town does would give the router something to work with; it
would also spread the company out, which is a look Greg has not seen yet and
should decide on before anyone builds it.

### Radiating, and the second pick-up (2026-10-02)

Greg: *"Nodes should be automatically positioned to radiate from the parent…
if I drag a family group away from a shared parent, the highest-ranking node in
the dragged group should position itself closest to its parent, regardless of
how far that is. This should mean the connection line flows freely from that
node to the parent uninterrupted — like a leaf on a branch."*

One rule, applied at every rung: **a unit's children go on the far side of it
from its own way home.** The branch's governing node is then strictly the
nearest member to the parent, nothing of its own family stands in front of it,
and the way home is open ground the whole way — so the router draws the straight
line without a single routing rule changing. That matters: the no-crossing and
sibling-exemption rules are untouched, and this only stops handing them ground
they cannot work with.

It lives in `reflow`, as `RADIATE_BIAS` — three rings is the price of a face
pointing the wrong way, so a child takes a cell two rings out on the right side
rather than touching its parent on the wrong one.

#### The gesture, which is the consent

Greg: *"When a user first moves the group of nodes, the rearrange shouldn't
happen — the block should move as-is, since this is predictable. If a user then
picks up the governing node of that block within, say, 30s, and moves it within
the nearest 4x4 grid of hexagons, then the rearrange function should kick in and
tree the thing away from the grandparented origin."*

So nothing is ever rearranged behind a hand that did not ask for it:

1. **The first drop keeps the shape, always.** What you built is what lands.
2. Put it down, and its governing node wears a **dashed teal ring** for 30
   seconds — the offer. Without it nobody would ever find this.
3. Pick *that* node back up and set it down **within two rings**, and the branch
   trees itself. The landing preview turns teal rather than blue, so the
   gesture is visibly a different thing from an ordinary move.
4. Carry it further than two rings and it is a plain move again, rigid.

A 4×4 block of squares has no exact hexagonal twin; two rings is 19 cells, the
nearest honest equivalent, and it happens to match `NUDGE_RINGS`. The clock and
the hop live in the lab (`RADIATE_WINDOW_MS`, `RADIATE_RINGS`) because
`arrange.ts` has no clock and does not know where the hand has been; the engine
is told only *whether* to tree and *where home is*.

There is **no dialog**, because the gesture is the consent — unlike a reshape,
which still asks, because that one loses a shape somebody built.

**Verified in the browser** on Sparrow Jam, 2026-10-02. Starting from the bad
case — Granite Division at `0,1` with its child Everest Team 2 at `1,1`, *tied*
for closeness to their grandparent — the second pick-up moved Granite to `-1,2`
at distance 2 with both children at 3, and the chain became one unbroken
straight line. A subsequent far drag (`1,2` → `-2,5`) translated every member
exactly, confirming the two-ring gate. Picking up a *child* rather than the
governing node correctly does not arm the gesture.

### Where the people stand (2026-10-02)

Greg: *"People should orbit on 'rings' that are offsets of the node hexagon.
They gather on the side opposite the connection line, with one exception — the
team lead, who sits near the connection line. They do not sit 'inside' the team
node — but they should sit inside the host tile."*

Until now people were placed by `placeUnitSeats`, the orbital engine's own
function, on the reasoning that a hexagon was a fence around the same idea. It
is not. That function sits the first six people **inside** the unit and the rest
on **circular** rings — two things this map cannot do. So people have their own
module now, `hex/people.ts`, and it is a hex idea rather than a borrowed one.

Rings are hexagons concentric with the node and the cell, all three in the same
orientation, so the whole figure is one family of nested hexagons. A position on
a ring is a **perimeter parameter** `t` in [0, 6) — one unit per side, so equal
steps in `t` are equal *distances*. (Equal steps in **angle** would bunch people
at the corners, which is the mistake this parameterisation exists to avoid.)

Filling runs outward from the point opposite the way home, alternating sides, so
a team of four is a small arc on the far side and a team of fifty wraps most of
the way round — without anybody deciding which case they are in. The lead is the
exception: innermost ring, home side, so the eye coming down the chain arrives
at the lead first.

#### The one line that makes it neat

Greg, 2026-10-02: *"make the way the people arrange themselves on each rung nice
and neat — please write a line of code that governs an evenly-spaced pattern
along the rungs."*

```ts
const slotsOn = (r: number, step: number) => 6 * Math.max(1, Math.floor(r / step));
```

**A whole number of people per side.** Every ring then carries a dot exactly on
each of its six corners with an even run between them, and consecutive rings
differ by exactly six — which is the lattice's own arithmetic. A team cell comes
out as 3, 4, 5 and 6 to a side, and because the slots are anchored to the
hexagon rather than to wherever the crowd starts, every dot sits on a radial
line out from the centre. Four rings read as one honeycomb instead of four
unrelated arcs.

`floor` rather than `round` because it doubles as the safety bound: it can only
make the spacing wider than `step`, never narrower, so two dots cannot touch
however the radii fall. Measured, the closest two dots anywhere are 38.5 apart
against the 28.5 they need.

The lead pays for this: it takes the *nearest slot* to the chain rather than
sitting exactly on it, which on an eighteen-slot ring is at worst about ten
degrees off. That is the price of the pattern lining up, and it is worth it.

**Fitting inside the tile is one inequality.** Two concentric hexagons in the
same orientation are related by a plain scale, so the narrowest gap between a
ring of circumradius `r` and a hexagon of circumradius `R` is `(√3/2)(R − r)`,
at the middle of a side. A dot of radius `p` clears when `R − r ≥ 2p/√3`. That
gives both the innermost ring (clear of the node) and the outermost (inside the
cell), with no special cases. People who do not fit are **left out** rather than
drawn over the boundary — spilling into the neighbour's cell is the one thing a
lattice must never do.

People are **half again as big** as on the orbital map and the rings are spaced
wider, both asked for on 2026-10-02 (*"let's make human nodes 50% bigger — scale
1.5x"*, *"a bit more spacing"*), and a unit may use **four rings** (*"let's
provide for four possible rungs"*).

| team | rings used | people per ring | closest two dots |
|---|---|---|---|
| 3 | 1 | 3 | 39.0 |
| 8 | 1 | 8 | 39.0 |
| 50 | 3 | 18 + 24 + 8 | 38.5 |
| 108 | 4 | 18 + 24 + 30 + 36 | 38.5 |
| 130 | 4 | 18 + 24 + 30 + 36 — **22 left out** | 38.5 |

Two dots need 28.5 units between centres, so none of these touch. A team cell
holds **108** at `roomy` and **84** at `tight`, which makes Greg's fifty
comfortable rather than a squeeze.

#### What four rings costs, and where it shows

Four rings of larger people is a real ceiling, and a **shallow** unit feels it
first: its node is a large share of its cell, so the gap left for rings is thin.
On the fixtures:

| | roomy | tight |
|---|---|---|
| Digital Tailoring | 1 | 1 |
| 1,000 people | 1 | 12 |
| Northwind | 1 | 23 |

The single person at `roomy` is on the **root**, whose 85% node leaves no room
for even one ring. The `tight` figures are teams high up the tree — that fixture
puts teams on every rung from CEO+2 down, and a fifty-person team at rung five
has one ring of 24 to put them on.

**The lab now says so on screen** rather than quietly dropping them, because the
alternative — drawing over the boundary into somebody else's tile — is the one
thing a lattice must never do.

There is a cause worth naming: `contentRadius` still sizes a cell from the
*orbital* seating model (two rings of the old, smaller seat). It is now sizing a
cell for contents it no longer holds. Making the cell size follow from the
people model instead is the honest fix, and it changes the density of the whole
map, so it is Greg's call rather than a tidy-up.

#### The node ceiling came down to 85%

Greg: *"let's put maximum node sizes (even master/centre) as 85% of total cell
area… the only change here is a maximum size. The minimum size stays the same."*
A node that filled its cell had no ring left to stand anyone on. The grading is
otherwise untouched: evenly spaced rungs from 85% down to 10% by area.

The edge this creates: a node at 85% leaves no room for even one ring of the
larger people, so the **root** cannot hold anyone directly — at either density,
and at `tight` the first rung of a deep company cannot either. See *What four
rings costs* above.

#### People arrive much earlier, and by cell size rather than zoom

Greg: *"it feels like we need to zoom too far before people become visible…
Ideally, we want to be able to see two or three teams on a standard 13" display,
and more on a larger screen."*

The orbital map reveals people at 1.7–2.1× world scale. That is the right
question asked of the wrong map: there, a unit's size depends on what it
carries. Here **every cell is the same size**, so the honest question is how big
a cell is *on the glass* — and that answer travels between a 13" laptop and a
32" monitor without being retuned.

People are now fully shown once a cell's circumradius reaches **230px**, so a
cell is 460px across and a 1440px laptop shows about three teams. They begin
arriving at 140px, around five cells across. In world scale that is 0.44–0.72×,
against 1.7–2.1× before: **people appear roughly three times further out.**

This is computed in the lab, not in `lib/map/camera/lod.ts`, so the orbital map's
own ladder is untouched. If the hex layout is ever promoted, that decision needs
making properly — see *Where the engines rub*.

#### The fixture now carries both extremes

`buildDeepOrg` takes a `spotlight` option that forces the first team to a given
size and the last to another; the lab asks for **3 and 50**. Team sizes are
otherwise 5–13, which never showed either end: not the team small enough that
the ring round its node is nearly empty, nor the one big enough to ask whether a
cell can hold a crowd without spilling. Off by default, so every existing
fixture is unchanged.

### Lines that belong to the grid

Greg: *"connection lines, where visible, should follow strict routing, meaning
they flow along one of the angles that define the hexagons… they should also be
chunkier and of a darker colour so they are visible on the very pale grey
background."*

On a flat-top lattice those angles are **30°, 90°, 150°, 210°, 270° and 330°**
— six directions sixty degrees apart, offset thirty from the horizontal. A line
along any of them is parallel to an edge of every hexagon it crosses, which is
what makes it read as part of the grid rather than drawn over it.

`axialRoute` in `coords.ts` does it: any hex vector decomposes into **two** of
those directions with whole-number steps, because adjacent directions form a
basis of the lattice and their determinant is one. So a route is at most two
straight runs and one bend, with the longer run first. Neighbouring cells give
a single straight run and no bend, which is the common case. A test sweeps 169
destinations and checks that no segment ever runs along anything but the six
axes.

Drawn as a dark core over a white casing, so it stays readable over both a
near-black executive tile and a pale wash one.

### Colour

Greg: *"hue as the indicator of hierarchy, and colour as the indicator of
subject… deep/dark red is 'CFO'; lightest wash purple is 'marketing interns'…
the hues are relative — they step according to the number of hierarchical
layers."*

Built as: **hue says which part of the company, lightness says how deep**, with
the lightness span scaling to the company's own depth so a two-rung company
gets two adjacent shades rather than black against white.

Hue comes from a **region** — the rung whose population is nearest the square
root of the company's unit count, capped at twelve. Two earlier rules were
wrong in opposite directions: "child of the root" painted all 395 units one
blue, because this company's root has a single child; "the shallowest rung with
at least six units" gave a thirteen-unit company nine regions, which is a
different hue for nearly every tile.

It should come from **function or discipline** once a unit carries one. People
have `disciplineId`; units have nothing, so the region is standing in.

### What the allocator does now, measured

Re-measured 2026-10-02, after the doorstep price. Northwind is
`buildDeepOrg(people: 2400, maxDepth: 11, seed: 7)`; the wide column is the same
seed at `maxDepth: 6, span: [2, 20]`.

| | 2,562 people | wide spans (max 20 children) |
|---|---|---|
| children touching their family | **94%** *(was 88%)* | **93%** |
| children touching the parent itself | 49% *(was 46%)* | 8% |
| families that are one patch | 106/131 *(was 86/131)* | 13/29 |
| exclaves | 25 *(was 48)* | 21 |
| layout | 9ms | 13ms |

The wide column barely moves, and that is expected: with twenty children a
parent has five seats to give and fifteen children who cannot have one, so the
doorstep price has almost nothing to protect. Wide spans are carried by the
sibling-edge rule, not by adjacency to the parent.

The wide-span collapse is gone. Seating children against the parent alone held
adjacency at **24%** on a company with realistic spans; letting them seat
against siblings holds connection at **93%**, and the difference is one search
looking at a family's edge instead of a parent's.

**Three rewrites were tried and abandoned** chasing exclaves to zero, all
reserving ground before placing anyone: growing a region outward from each
child at once (discs from adjacent seeds strangle each other), scoring cells by
the room a subtree would need (a big branch abandons its parent to find room),
and partitioning a parent's ground into angular wedges. The best of them placed
**201 of 395 units**. If you try reservation again, the wall is that a branch
handed one cell per unit has nothing left to subdivide, and every rung below it
starves — the quota has to carry slack at *every* level, not only the top.

The remaining 6% are exclaves, and that is not simply a failure: rule 8 makes
a tile sitting apart from its family a legitimate arrangement, shown by the
outline rather than a tether. **Gather**, when it is built, is the remedy.

### An atlas rather than an archipelago (2026-10-03)

Greg: *"We need to gently push for the whole thing to render with more visual
organisation."* Asked which lever first, he picked two: **a readable grammar**
and **nested territories**. They are built as one piece, because a grammar
written against the archipelago would have had to be written again once
territories nested.

Live at `/lab/hex` behind a **shape** toggle — `atlas` or `archipelago`, one
keystroke apart. Both are kept because the only way to settle which reads better
is to put them side by side. `territory.ts` is the new module; `allocate.ts` is
untouched.

#### What was wrong, as something measurable

The hierarchy was a **place** at exactly one level. Every unit reserved ground
sized to its own direct staff and its children were pushed *outside* it. So a
division was not somewhere you could point at — it was a hue shared by teams
scattered among its siblings' teams, and colour was doing all the work of saying
"these belong together".

#### Measure upward, place downward

Two passes. Every unit works out how big its ground must be and where its
children sit inside it, in a canonical frame facing one way; then the root lands
at the origin and each territory is translated and **turned** into place. A
spine is always one of the six lattice directions, so that turn is a multiple of
60° and therefore *exact* — the arrangement survives it cell for cell.

This is why it does not hit the wall the three abandoned rewrites hit. They all
reserved ground **before** knowing what had to go in it. Measuring upward makes a
parent's size a consequence of its children's rather than a guess at them.

The grammar: the heaviest child continues its parent's street, the rest fan off
alternately to either side, backwards only as a last resort. Sibling order is
headcount descending, ties by name, behind one swappable function — stable and
explainable, though not *meaningful* the way function or discipline would be.

#### The dead end: territories as discs

The first version made a territory a **disc** around its contents, and the
measurement killed it outright. Packing k discs inside a disc wastes about two
fifths of the ground, and nesting **multiplies** that waste at every rung. Over
eleven rungs it compounded to a root territory of **39,331 cells holding 395
units — 1% full**, and a map 5.7 times wider than the archipelago.

No tuning reaches that. It is not slack, it is the geometry of putting round
things inside round things. A territory has to be **the shape of its contents**,
which cannot waste anything — and is what an atlas looks like anyway, since
countries are not circles.

#### A round number that was a bug

The first cut of the spacing charged the clear tile between a parent and its own
children as well as between siblings. Every leaf was pushed a tile off its own
family and "children touching their family" came out at **exactly 0%**. A number
that round is always a bug and never a trade-off. The gap now separates
*territories* — a child that brings a subtree with it — and a lone node may sit
against its kin.

#### Two fixes that came out of Greg's question (2026-10-03, later)

**The packer had no idea what a family was.** It scored a position by how much
it grew the territory and how near the spine it sat, and had *nothing at all* to
say about landing next to your own parent or a sibling — which is the oldest
rule in this engine. An omission, not a decision. `FAMILY` is that missing term.

**The clear tile was being charged to things nobody calls a place.** Greg's rule
was *"sibling **teams** have one tile separating them"*, and it was being applied
between every pair of sibling territories at every rung, two mid-level
structural nodes included. `PLACE_SIZE` is where a thing becomes a place: a
clear tile is a visual device, and two single cells with a gap between them read
as two cells with a gap, not as two regions. Four cells, so that in the mode
that matters — people promoted to units, where a team is its node plus its
people — a **team** earns clear ground and an individual does not. Which is what
Greg asked for in the first place.

The sweep behind that number, on the 2,562-person company with people as units:

| `PLACE_SIZE` | stranded | touching family | span | mean chain | cells with 2+ chains |
| ---: | ---: | ---: | --- | ---: | ---: |
| 1 (every node) | 853 | 71% | 204×215 | 3.3 | 2,651 |
| 2 | 622 | 79% | 186×210 | 3.2 | 2,592 |
| **4** | **490** | **83%** | 156×234 | 3.1 | 2,508 |
| 9 | 431 | 85% | 153×214 | 3.0 | 2,506 |
| no gap at all | 363 | 88% | 108×179 | 2.7 | 2,243 |

It is a straight trade all the way down, with no sweet spot to discover: every
clear tile costs a little cohesion, a little length and a little spread. Four is
where the thing being separated is the thing Greg named.

#### The search was scanning the horizon

With people promoted to units the atlas took **ten seconds** on Northwind. The
packer swept a disc that grew with the company, for every one of 2,957 children.

A territory's cost is dominated by how much it grows its parent, which rises
with distance — so the answer is nearly always in the first ring that has room.
Searching outward and stopping a couple of rings after the first success is the
same trick `findCell` uses in `allocate.ts`. **10,171ms → 216ms**, a 47-fold
cut, with the layout essentially unchanged (853 stranded against 849, same
spans).

#### The trade, on the 2,562-person company

| | archipelago | atlas |
| --- | ---: | ---: |
| span | **45×48** | 68×70 |
| next to its parent | 61% | **67%** |
| touching family at all | **96%** | 83% |
| families as one patch | **115/131** | 79/131 |
| chains walking under a stranger | 102 | **7** |
| mean chain length | **2.8** | 3.6 |
| cells carrying two or more chains | **229** | 311 |
| time | **14ms** | 131ms |

With people as the smallest unit: 2,957 units in **216ms**, 83% touching their
family, 1,427 of 1,686 families reading as one patch.

#### Where the exclaves come from — not from the data

Greg asked the right question: *"does the data schema require exclaves for the
sake of the demonstration?"* Measured, **no**.

- **No unit in either company has more than five children.** The widest fan is
  four on Northwind and three on Digital Tailoring, against six neighbours of
  which one is the way home. The lattice never runs out of room next to a
  parent, so the shape of the invented company never forces a unit away from its
  family.
- Turning our own spacing off is what moves the number. On Northwind the atlas
  gave **59** units not touching their family with no gap and **110** with one.
  Every one of the extra 51 was the clear tile we insist on.
- The 59 that remained were the packer's doing, not the data's — the missing
  family term above. Both are fixed, and Northwind now strands 74 rather than
  110 with 81% touching their family rather than 72%.

#### And the spaghetti is the same rule

The crossing lines are not chains cutting through other people's tiles — by that
measure the atlas is far *better* than the archipelago (14 passages under a
stranger against 102). What the gap creates is **corridors**, and the router
funnels many chains down the same ones: mean chain length 2.8 → 4.1, longest
12 → 29, and cells carrying two or more chains 229 → 366.

So both of Greg's complaints trace to one rule — a clear tile between sibling
territories at **every** rung. Which leaves a decision rather than a fix: whether
the clear tile belongs between every pair of sibling territories, or only
between the places a reader thinks of as places.

#### Room that grows with the level of abstraction (2026-10-03, later)

Greg: *"At the highest level of abstraction, the greatest number of hexagon
tiles are found between nodes. At the lowest level of abstraction, the team
level, each team should by default group together, resist exclaving, and exist
with a bubble of 1 tile around it… for every level of abstraction, add 1
additional tile-spacing rule between nodes."*

The gap is no longer one number. A unit's **tier** is how many rungs of *places*
sit under it — nought for a team, whose children are people rather than regions;
one for whatever holds teams; up from there. A unit leaves `tier` clear tiles
between its children, and holds its own node `tier − 1` tiles off theirs.

That offset is load-bearing. A team and whatever holds teams get **no** bubble,
so people stay pressed round their team and teams round theirs — which is the
same lesson as the 0% bug above, learnt twice.

**Between *nodes*, not between ground.** The first version blocked the ground
round a parent outright, so no cell of a child's whole territory could enter it.
A territory surrounds its own node in every direction, so the master centre's
only report was pushed **21 tiles** away and family cohesion fell ten points
across the company. Holding the nodes apart and letting the ground come as close
as it likes says what was actually asked for and costs nothing elsewhere.

Northwind now: the master centre sits 4 tiles from its reports in teams view and
6 with people promoted, against 1 and 2 before.

#### A statistic that had started measuring the rule

Adding the tier spacing sent "units not touching their family" from 74 to 121
with nothing going wrong — a unit held off its parent *on purpose* was being
counted as stranded. The question worth asking is whether a unit is **further
out than it was told to be**, and `spacedBy` carries what it was told. On that
measure Northwind strands 60 rather than 74, and 85% sit where the rule put them
rather than 81%.

Raw adjacency to a parent is *down*, 65% to 53%, and that is the feature. It is
no longer asserted in the tests, because asserting it would be asserting against
Greg's rule.

#### The confetti: one flag in the wrong place

Greg, 2026-10-03: *"when I move a team node, or a node that controls a small
number of teams, the auto-arrange works basically perfectly… It's a different
story if I try and move a whole family tree — the auto-rearrange struggles and
then blasts teams into confetti."*

`placeIsland` gated "move it as it is" on `isOnePatch` — is the branch one
connected patch? Under nested territories **it never is**, because the clear
ground inside a territory is the whole point. So every branch above about ten
units skipped the translate-as-is path and the nudge after it, and fell through
to a full re-layout.

Measured on Northwind with people as units, dragging branches of each size:

| branch | one patch? | landing | shape kept |
| ---: | --- | --- | ---: |
| 9 | yes | nudged | 100% |
| 14 | **no** | gathered | **7%** |
| 135 | **no** | parted | 44% |

The same 14-unit branch on the archipelago *is* one patch, translates exactly,
and looks perfect — which is why this read as a big-branch problem rather than
as a gate in the wrong place. Trying the exact placement regardless takes both
to **100%**.

Whether a branch is one patch is a fact about what is worth *warning* about when
a shape is lost. It was never a reason not to try. Two tests asserted the old
behaviour — one of them that a scattered family is gathered on the way, which
contradicted Greg's rule from 2026-10-02 outright and went unnoticed while every
branch worth dragging happened to be one patch.

#### Two faults found by one screenshot (2026-10-03, later still)

Greg sent a panel reading *"72 units sharing a cell with another — they cannot
be pointed at"* after a tidy up of 1,258 placements. It turned out to be two
unrelated things, and the worse one was the one nobody had reported.

**The atlas was silently dropping units.** 2,931 placed out of 2,957. The ring
walk in `placeChild` skips everything inside the parent's bubble, and the reach
that bounds that walk did not account for it — so a high-tier unit whose first
child was small had *every* candidate skipped, came back with nothing, and the
child was dropped from the map without a word. It only appears as a count that
does not add up, which is why it survived a browser check, a full sweep and a
test suite. There is now a `stats.unplaced`, a test built from the shape that
starves (verified to fail on the old code), and a red line in the lab when a
unit has no cell at all.

**Hand placements were being replayed onto cells that had moved on.** An
arrangement lives in one browser while the engine changes underneath it — a new
rule, a different shape, a fix to the packer — so the cell somebody put a tile
on last week now belongs to somebody else. Applying them blindly stacked units:
measured, an arrangement of 1,479 placements saved under the archipelago and
replayed on the atlas buried 66.

The fix keeps the map **injective at every step**. The layout starts with one
unit per cell; a placement is taken only when its target is free; taking it
frees the cell that unit came from. The invariant cannot then be broken by any
sequence of placements, however stale, and anything refused simply stays where
the engine put it. Arrangements are also keyed per shape now, because an
arrangement of the archipelago is not an arrangement of the atlas.

Neither fault was the tidy up, which produces no collisions at all on a fresh
map in either shape — it was the input it had been handed.

#### In extremis: the halo uncapped, and what it costs (2026-10-03, later still)

Greg: *"remove the cap on how much spacing can exist at the top levels — we can
reinstate it later… yes, I said nodes, but I also mean people/teams too, with
the exception of team leads. So the space around master-centre in the next
iteration should be HUUUGE. I want to see it in extremis before moving to the
next stage."*

Three changes, and the reasoning behind them is worth keeping, because the
spectacle is not the point. He is *"slowly trying to fix the radiate/fan out
problem without forcing the thing into a fan — I want it to arrive there
naturally by merit of the structure and rules about how the structure is
displayed and made legible."* A centre too big to sit beside leaves its children
nowhere to go but **around** it, so the radial reading falls out of the spacing
rule rather than being imposed by one.

- **`MAX_TIER_GAP` is `Infinity`.** Set it to a number to put the lid back on;
  that is the whole of reinstating it.
- **The halo turns away a child's whole territory**, people and teams included,
  rather than merely holding its node at a distance. This is the thing that was
  tried and backed away from a few hours earlier, when it pushed a report 21
  tiles out — which is now the intended behaviour rather than an accident.
- **A unit's own lead walks through the halo**, and is seated first so it has
  the pick of the ground inside it. The person who runs a place belongs at its
  door.

On the 2,562-person company, with people as the smallest unit:

| cap | master centre → its reports | span | time |
| --- | --- | --- | ---: |
| 1 | 1, 3 | 246×199 | 219ms |
| 3 | 1, 6 | 282×359 | 371ms |
| 6 | 1, 7 | 480×368 | 808ms |
| **none** | **1, 35** | **531×437** | **2,885ms** |

The leading `1` in every row is the lead, through the halo. Everybody is still
seated at every setting — 2,957 of 2,957, nothing unplaced — and family cohesion
does not move at all (88% throughout), because the halo pushes a whole territory
out as one piece rather than tearing it apart. 361 of 395 leads sit directly
against the unit they lead.

**2.9 seconds is the price of looking at it**, and it is a real cost rather than
waste: starting the ring search outside the halo instead of walking it saved
almost nothing, so it is the search at that radius, not the skipping. A cap of 3
costs 371ms for most of the effect. The tests pin their behaviour to an explicit
cap rather than to the default, because the default is now a dial being turned.

#### A curved gap, bunched humans, and a lever that was already spent (2026-10-04)

Greg asked for three things. Two went in; the third turned out to be done
already, by something else.

**The spacing follows Fibonacci rather than climbing.** *"That should visually
cluster teams and their parents and push ever more space between the more
distant relatives."* 0, 1, 1, 2, 3, 5, 8, 13 — the first terms barely separate
at all, so a team and the thing that holds it stay as tight as they were, and
then it runs away. Relatedness stops being something the eye counts rungs to
recover and becomes something it reads off the width of a gap.

**It needed a fix before it could work at all.** The engine had only a cell
count to judge by, so a manager with three reports looked exactly like a small
department — four cells. Tiers accumulated *inside* teams: eleven of them on the
45-person company, where the structure has four. Under a linear rule that merely
looked odd; under Fibonacci it put **57 tiles** between the master centre and
its own report on a 45-person company. The engine is now told which units are
people, and a person is never a place however many report to them. Same company,
same curve: 8 tiles.

**People are bunched by a gate, not a preference.** *"Teams of humans should be
forced together until a user separates them. So the point is we allow exclaves,
but only when they are manually created."* `FAMILY` against `GROWTH` was a
preference and the wrong way round for an individual — a ring of territory cost
100 while standing apart from your own manager cost 45, so the packer would
strand somebody to save a ring. Somebody who must land against their family can
only be on one of the six cells round a family member, so those are enumerated
directly rather than searched for. **People adrift from their own family:
19.6% → 1.7%**, and the remainder means the ground genuinely ran out.

**The routing was left alone, and this is the evidence why.** Sweeping the turn
cost from 12 to 500 on the 2,562-person company:

| `TURN` / `TURN_PER_SPAN` | dead straight | corners per chain | under a stranger |
| --- | ---: | ---: | ---: |
| 12 / 6 (today) | 73% | 0.37 | 0 |
| 60 / 30 | 74% | 0.29 | 22 |
| 120 / 60 | 75% | 0.25 | 34 |
| 500 / 250 | 75% | 0.25 | 36 |

Two points of straightness for 36 chains driven under somebody else's tile, and
flat past 120. **The lever is spent** — which is the fourth time this study has
reached for the router and found the answer was placement. And placement has
already delivered it: under the atlas chains run **88% dead straight at 0.24
corners each**, against 73% on the arrangement the sweep was measured on. What
Greg asked for is in, it just did not come from `route.ts`.

#### The cap came back, and performance is now the blocker

**Uncapped Fibonacci is 233 seconds** on the 2,562-person company with people as
units. The root earns a halo tens of tiles wide and the search at that radius
stops being affordable by any margin — the test suite times out against it. So a
number came back.

> **Corrected 2026-10-14.** This paragraph said *"the cap is back at 5"* for a
> week while the code said `3`, and then `48`. A rule set drafted from this file
> on 2026-10-07 duly proposed *"keep the current size-proportional gap and its
> cap of 5"* — a large tightening, described as keeping things as they are, from
> a number that was never in the code. Greg: *"the spacing gap cap at 5 is
> invented. We can revoke it."*
>
> There is no cap as a design choice. `GAP_SHARE = 1/3` is the only spacing
> number with a reason behind it. What remains is a **guard against a
> pathological company**, set wide enough never to bind on a real one, and the
> 233 seconds above is the whole of why it exists. See `docs/MAP-LAWS.md`,
> Law 4.

Even capped, the 2,562-person company takes about **four seconds** in people
mode. Two attempts at the packer made no difference: starting the ring search
outside the halo rather than walking it saved nothing, and enumerating an
individual's family-adjacent cells improved the layout without moving the clock.
It is the search itself at this scale, and it wants real work rather than a
tweak. Until then this arrangement is comfortable on the 45- and 1,000-person
companies and slow on the largest.

#### Tidy stopped spacing anything, and the ranking is what fixed it (2026-10-14)

Greg, on the first build with the drop path's own spacing removed: *"the
auto-tidy works amazingly, but it doesn't provide any space between peer
groups… mostly like-teams/branches stay together, but they do tend to split in
some cases. Further, they bunch together with no space between them. I think the
fix is reinstating the spacing function — it feels like it's not there anymore
at all."*

It was not there at all, and that was this engine's fault. Removing `gapBetween`
from the drop path was right — it was a second, tighter rule — but **nothing was
put in its place**, and `neaten` never had a spacing rule of its own. Its gather
phase seats a drifted branch on the *nearest* free cell beside its family, which
packs a map solid: every boundary ends up one tile wide and stops saying anything
about what it separates.

Measured on the 1,000-person company, one move-and-tidy:

| | clean load | tidy, no spacing | tidy, layout's spacing |
| --- | ---: | ---: | ---: |
| cells touching another branch | 53% | **79%** | **53%** |
| whole branches | 27/58 | 47/58 | 35/58 |
| curl-back | 37% | 33% | 32% |
| cost per press | — | 22ms | 32ms |

On Northwind: crowding **81% → 47%**, and the company stops collapsing — span
129×83 back to 146×163.

**The fix is Law 4 rather than a new rule.** `layoutTerritories` already records
what it kept clear round every unit, as `spacedBy` — a share of the size of the
thing it separates. Tidy is handed that and honours it. It is now carried on
`Allocation` so the lab can pass it; the archipelago allocator has no such
notion and passes nothing, which leaves tidy packing tight exactly as before.

**And the ranking earned its keep.** The obvious stronger fix is to let a branch
move out to the rings where its owed gap is actually available. That halves the
crowding again — and takes whole branches from 47/58 to **31**. It is Law 2
losing to Law 4, and it is the *other* half of what Greg reported in the same
breath. So the branch still sits against its family and the room comes from
choosing which of those cells. Without a ranked rule set that trade would have
looked like a win.

Two measures were wrong on the way, and both flattered the answer. Counting a
family as "parent plus direct children" measures an archipelago property the
atlas never had; what the eye reads is the **outline**, which wraps a unit and
all its descendants. And counting a unit touching its own grandchild as
"crowding" measures cohesion, not crowding — kin is a unit's whole subtree plus
its line of ancestors, and everybody else is a stranger.

#### The five-second re-pickup had no spacing either (2026-10-14)

Two paths re-lay a branch: the **tidy button** (`neaten`) and the **five-second
re-pickup** (`placeIsland` with `radiateFrom`, which calls `reflow`). Giving the
first the layout's figures and not the second produced exactly the
inconsistency Greg named: *"the 'pick up and place within five seconds' rule…
pushes everything together so the gap between anything is zero, which means it's
not applying the same rules as the auto-tidy."*

The cause was a hole rather than a decision. `reflow`'s spacing came from
`gapBetween`, the old model's kinship rule; the drop path stopped passing it on
2026-10-14 because it was a second, tighter rule, and nothing replaced it on
this path.

`reflow` now takes the same `TidySpacing` the tidy button gets — `spacedBy`
plus a kinship test, where kin is a unit's own line of ancestors and its own
descendants and everybody else is a stranger. Crowding inside a re-treed branch:

| | 1,000-person | Northwind |
| --- | ---: | ---: |
| clean load | 48% | 57% |
| re-tree, before | **98%** | **99%** |
| re-tree, now | 60% | **51%** |

Cost is 2ms on a 42-unit branch and 11ms on a 173-unit one, and it recomputes
only when the hand crosses into a new tile, not per pointer event.

A plain drop is still handed nothing. Law 0: the hand outranks the engine, and a
drop that quietly spaced itself out would be the engine arguing with it.

#### The confetti, found (2026-10-14)

Greg reported it four times and it resisted reproduction for a week. Two things
hid it, and both are worth not rediscovering.

**A drop onto empty ground is always clean.** Every earlier attempt translated a
large branch into open space, which `placeIsland` answers with `fits` — a plain
cell-by-cell translation that cannot break anything. The fault needs the branch
to *overlap* somebody, and with the gap now a share of a territory's size the
map is spaced so generously that overlap has to be aimed for. On Northwind the
worst overlap reachable by any translation of the Everest Region branch is 56 of
its 1,258 cells.

**"The largest child of the root" is the wrong branch to grab.** The fixtures put
one pass-through unit under the root, so that branch *is* the whole company and
nothing is left outside it to collide with. The earlier probe — *"a 332-unit
branch with five child trees, dropped three ways"* — was testing a translation
into a vacuum.

The gesture was recovered from the 2026-10-06 session transcript, which had
preserved the five unit ids Greg's hand grabbed. All five are inside **Everest
Region**, whose subtree is 1,258 units — exactly the move count his saved
arrangement held. His arrangement was that one branch moved.

**What it does.** Over 484 overlapping drop targets on the 1,000-person company,
with today's code:

| where the governing node lands | outcome |
| --- | --- |
| on a free cell | 293 `parted`, 157 `nudged`, **11 `gathered`** |
| **on an occupied cell** | **22 of 23 `gathered`** |

`gathered` is the confetti: the branch is re-laid from scratch and whole families
inside it fall from **224/248 to about 80**. So it is not random — it is
overwhelmingly *dropping the node you are holding onto a tile somebody already
has*, which is the natural way to say "put this over there". It does not rectify
on a second drag because once the shape is gone, a later clean drop faithfully
translates the broken shape.

**And it split a proposed deletion in two.** The draft rule set called stopping
`groupOf` and `gapBetween` reaching the drop path *"two deletions, not
rewrites… the cheapest high-value change"*. Measured on the clashing drop:

| `placeIsland` given | landing | whole families |
| --- | --- | --- |
| `groupOf` + `gapBetween` (today) | `parted` | 224/248 |
| `groupOf` only | `parted` | 224/248 |
| neither | **`gathered` every time** | **73–99/248** |

`gapBetween` is the harmful half — removing it alone slightly *improves*
cohesion, and it is gone. **`groupOf` is load-bearing**: it is what tells a clash
which body may step aside so the rest can translate as-is, and deleting it turns
every clashing drop into confetti. It does not want deleting; it wants to
*become* the territory rather than a flat team id.

A third claim from the same brief did not survive either: **`neaten` is not the
confetti engine.** On the recovered gesture, tidy *improves* cohesion — children
touching their family 86.4% → 91.5%, adrift 403 → 251, whole families 1,522 →
1,541. Stopping it consulting routes may still be right on principle (Law 5), but
it is not a cheap win and it is not what Greg has been seeing.

Repro: `npm run hex:confetti` for Northwind; `app/lab/hex/confetti.test.ts` for
the regression, which states Law 2 as an `it.fails` so the suite stays honest
about it rather than silent.

#### Facing, and why fixing it only got halfway (2026-10-06)

Greg, on the chain from a deep team looping over itself: *"if my child sits at
an angle to my source spine, then its child will similarly sit at an angle, and
since we're using hexagons, we end up with spirals within four steps."*

He was right about the mechanism. A unit's children grow along its **spine**,
and the spine was set from accumulated birth order — *you are the second child,
so you are 60° off your parent* — rather than from where the unit actually
ended up. Six turns is a circle, so a branch met itself inside four rungs.
Measured: **62% of units faced a different way from the one they were placed
in**, 466 of them by more than 120°.

Three fixes were measured on the 2,562-person company:

| | facing disagrees | >120° out | time |
| --- | ---: | ---: | ---: |
| accumulated birth order (before) | 62% | 466 | ~4,000ms |
| **place once, then face the way you landed** | **45%** | **296** | **645ms** |
| settle to a fixed point over four passes | 52% | 361 | 1,319ms |
| offer all six, keep one that lands where it faces | 48% | 370 | 1,603ms |

The single pass wins, and it is kept. It also made the layout **six times
faster**, which was not the point but is not an accident either: a branch that
does not wind back on itself is a branch the packer finds room for sooner.

**The two clever versions both failed, and for the same reason.** Iterating
oscillates rather than converging, because turning a territory changes where it
fits; and a self-agreeing direction often does not exist at all. Underneath
both: `placeChild` is dominated by `GROWTH`, which pulls every child toward the
parent's existing mass **whichever way it is turned**. Direction is not
something the packer optimises, so no amount of re-asking makes the answer come
back directional.

Which means the remaining 45% is not a facing problem at all, and Greg's own
proposal is pitched at the right level where this one was not: make proximity to
the **lineage** expensive — hardest near the great-grandparent, then the
grandparent, then the parent — so that radiating outward is what the packer
wants rather than what it is told. An earlier attempt at a plain homeward
penalty moved the needle barely at all (35.5% → 33.4% of units sitting nearer
the centre than their own parent), because it was weak against `GROWTH` *and*
because, with the facing wrong, "the home side" was not pointing home. It is
worth trying again now that one of those two is fixed.

#### A scatter tracker in the lab panel

Greg, 2026-10-06: *"can you put a tracker in that measures grouping size and
distance from parent on the live version while it's running — this should
establish how many human-nodes are scattered and by how far."*

Two lines in the panel, recomputed with the arrangement so they move the instant
anything is dragged:

- how many people are **not beside their own family**, and the furthest one;
- how many teams are **in more than one piece**, the worst, and team sizes.

The second is the one that catches confetti. A team whose people form one
connected patch reads as one thing; a team in nine pieces is the fault Greg has
reported four times, whatever produced it. Dragging a 106-unit branch across
Digital Tailoring left both lines unmoved, which is the first time that claim
has had a number behind it rather than a screenshot.

#### Still open

- **131ms against 14ms** in teams view, after the 47-fold cut. Closer to affordable, still an
  order of magnitude off the archipelago, and the number that matters against
  the ten-year-old-Lenovo bar.
- The spine only breaks ties; growth decides. If the streets do not read, that
  balance is the dial — `GROWTH`, `FAMILY` and `SPINE` in `territory.ts`.
- Whether the atlas or the archipelago is the better map. Both are live behind
  the **shape** toggle precisely so that nobody has to settle it in prose.

### What the outline wraps

Greg, 2026-09-30: *"the black outline should run around a node and all its
children, grandchildren, and so on — it should wrap the whole branch the
hovered tile births **unless** it's a child node with no children, in which case
the outline should outline the immediate family group: siblings and parent."*

`hoverGroup` in `arrange.ts`. Point at a manager and the outline asks *what do
you run?* — the whole branch, however deep. Point at a team that runs nothing
and that question has no answer, so it asks the only other one worth asking:
*who are you with?* — your parent and your siblings.

### The outline bug that six tests missed

Greg, 2026-09-30, on the hover outline: *"a bit… weird. I need a contiguous
outline of the whole joined shape, not a snaking millipede through some of
them."*

`outline` decides an edge is on the boundary when the cell across it is not in
the set. Corner `i` sits at `i × 60°`, so the edge between corners `i` and `i+1`
faces outward at `i × 60 + 30°` — and the six neighbour directions, in world
space, lie at 30°, 330°, 270°, 210°, 150° and 90°, **descending**, because
screen y grows downward while corners are generated counter-clockwise. The right
mapping is `edge i → direction (6 - i) % 6`. The code had `(i + 1) % 6`, which
is wrong for all six.

**It is wrong in a way that survives counting.** A wrong bijection still drops
exactly as many edges as a right one, so a family's shared edges stayed drawn
while parts of its real boundary went missing — the millipede. The test that
should have caught it asserted `segs).toHaveLength(10)`, which is the one thing
a wrong bijection preserves.

The test now derives the answer a second way and compares: an edge's midpoint is
halfway between the two cell centres, which needs no knowledge of corner
ordering at all. Six shapes, including a flower where the middle cell must
contribute nothing and a ring with a hole. **If you touch this function, that is
the test that matters.**

## Tidy up, in two presses

Greg, 2026-09-30: *"make it so the 'clean up' function actually just neatens up
islands rather than dragging everything back to the centre… an additional press
would pull the whole picture back to the compressed view."*

**The first press neatens what is there. Anything anybody placed by hand stays
exactly where they put it** — that is the whole difference from the reset, and
it is the orbital engine's Law 3 restated. `neaten` in `tidy.ts`, in two phases:

1. **Gather the stragglers.** Any branch that has drifted off its family, and
   that nobody placed there on purpose, travels back to its family's own edge
   carrying its shape with it. This is the allocator's rule applied locally, and
   it is what *"makes the islands neat"* actually means — a division's teams
   gather round the division rather than trailing across the map to it.
2. **Turn each branch to face the right way.** On a lattice the natural move is
   a rotation by a sixth of a turn about a cell: it keeps every unit on the
   grid, keeps a branch's shape exactly, and is the only transform that changes
   which way a branch faces without changing what it looks like. Each branch
   tries all six, discards any that would land on somebody, and keeps the one
   that clashes least — **a cousin crossing counts ten times a sibling one**,
   because siblings are bound to converge on their shared parent and cousins
   have no business meeting at all. Facing away from the incoming chain is the
   tie-break, which is what stops a line leaving a parent and looping back.

Measured on the 2,562-person company, with twelve branches dragged about by
hand and left pointing anywhere:

| | sibling clashes | cousin clashes |
|---|---|---|
| calculated layout | 6 | 32 |
| after hand-dragging | 5 | 56 |
| **after one press** | **0** | **21** |

63% fewer cousin clashes, and fewer than the calculated layout started with.
94ms. Every hand placement preserved.

**Gathering alone did most of it.** Rotation by itself managed 18%, because a
turn can only change which way a branch faces, never how far away it is — and a
chain that runs half the company is unreadable whichever way it points.

**One pass is one pass, not a fixed point.** Gathering settles, since a branch
already against its family is skipped. Turning does not, because turning one
branch changes the world the next is scored against. A test holds the property
that matters: a second pass may not make it worse. The product never runs one,
because the second press compresses instead.

## The orbits mode is parked, not finished with

The **layout** toggle still draws the company the way `/org` draws it today,
through this same renderer — so it picks up the new colour system, the hover
treatments and the routed lines for free.

Greg, 2026-09-30: *"the orbits model you've got going on in this version
seeeeeeems very close to what we want in that flavour of events. Let's stash
that for now but don't delete it — it's showing up very nicely."*

**So do not remove it.** It costs one branch in a `useMemo` and it is carrying a
finding of its own: the layout that already ships looks markedly better once
hue carries region and lightness carries depth. That is a change to `theme.ts`
and the renderer, not to the layout engine, and it could reach `/org` without
any of the hex work landing at all.

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

## The compass — where "outward" comes from (2026-10-14)

Greg, after the rule work landed: *"the 5s placement feature bunches peer
groups together — it does not observe any spacing rules"*, and *"we're getting
quite a lot of loopback on connection lines still."* Two faults, and the second
one was not where anybody had been looking.

### The lines were never the fault

Measured on a clean load, before any change: **94–96% of connection lines are
dead straight**, and only 1–4% wander away from their parent before coming
back. Routing is not what loops.

What loops is the **way home**. Walk a person up through every manager to the
master centre and count the rungs that take you *further* out:

| | 45-person | 1,000-person | Northwind |
| --- | ---: | ---: | ---: |
| the way home doubles back at least once | 78% | 94% | 97% |
| rungs that step further out | 17% | 24% | 25% |
| path walked ÷ direct distance, median | 1.96 | 1.79 | 1.88 |
| …90th percentile | 2.69 | 4.18 | 4.26 |

Every individual link is straight; the accumulation is not. That is what the
eye reads as a loop, and it is a placement fault, which makes it the **fifth**
time a line-drawing problem in this engine turned out to be a placement one.

### Why every previous attempt missed it

Law 3's number — units sitting nearer the master centre than their own parent —
had sat at 32–35% through two fixes aimed squarely at it. The reason, measured:
of the 408 offenders on the 1,000-person company, **only 151 were also placed
behind their parent**. The other 257 sat *forward* of their parent and still
ended up nearer the middle.

A local rule cannot see those 257, and every rule tried had been local:

- **birth-order facing** — 62% of units faced a way they had not been placed.
  Greg, 2026-10-06: *"we end up with spirals within four steps."*
- **reading the facing back off the placement** — 62% → 45% misfacing, and
  curl-back did not move.
- **penalising the home side** — 35.5% → 33.4%, and a fresh sweep of it here
  reproduced the same: 32.1% → 31.3%.

The cause is structural. `placeChild` runs inside `measure`, which is
bottom-up: when a unit's children are placed, nobody yet knows where that unit
will stand in the world. "Outward" could only be guessed from the last step
taken, and a chain of last steps is a random walk.

### What was tried and rejected

- **A second packing pass**, re-placing with true world directions. `placeChild`
  is **66–68% of layout time** (profiled: 2,073 calls, 283ms of 430ms on the
  1,000-person company), so this costs about +68%. Greg had just bought that
  time back by capping `MAX_HALO`.
- **Reserving a disc per territory**, so a later pass could rearrange inside it
  freely. Measured: a territory fills only **30% of the disc that bounds it**
  (mean across 245 territories). Reserving discs would roughly triple the ground
  each one claims.

Those two are worth recording together, because they are the proof that you
cannot have exact-shape packing *and* world-aware orientation in one geometric
pass. The way out is not to make the geometry cleverer.

### The compass

`headings` in `territory.ts` gives every unit a bearing **before a single cell
is packed**, from the shape of the company alone. The root owns the circle; each
unit hands its children an arc centred on its own bearing, shared in proportion
to how much of the company hangs beneath them; a unit's bearing is the lattice
direction nearest the middle of its arc.

It is O(units), needs no geometry, and because an arc is an **absolute** bearing
rather than a turn relative to a parent, **it cannot accumulate** — which is the
failure mode Greg named. It also replaced `settleFacing`'s second placement
rather than adding to it, so the layout does less work than before.

Two numbers shape it, and both are **chosen rather than measured**: the arc is
capped at half a turn (±90°, so nothing is ever aimed behind its parent) and
floored at a sixth (the narrowest fan that can still give two children different
bearings). Swept across all three companies every setting in range beat having
no compass, but neighbouring values jump around — one floor giving 9.7%
curl-back and the next 15.8% — because snapping a continuous bearing to six
directions flips many units at once. Tuning to the best reading would be
fitting noise.

### Law 2 outranks Law 3, and what it cost to learn

The first build charged every unit the full price of sitting behind its parent.
Teams whose children all touch them fell from **90% to 86%**, because `beside`
is satisfied by touching a *sibling*, so a person could satisfy their family two
cells out and the backward cost bought exactly that.

Fixing it by lowering the price gave the cohesion back and took curl-back from
8.1% straight back to 21.2% — the wrong lever. The right one is a gate: a **leaf**
pays for every ring past its parent's doorstep, at a price no bearing can
outbid. Insensitive to its exact value between 1,000 and 20,000, which is how
you tell a gate from a dial.

Scoping that gate to **leaves** rather than to everyone who is not a place is
worth its own line, because getting it wrong was the single worst reading of the
session: charged to every person, it caught managers in the middle of long
people-chains, and on Northwind drove curl-back to **47%** — worse than before
the compass — and widened the map by half.

### Measured

Clean load, people as the smallest unit, against the same build without the
compass:

| | 45-person | | 1,000-person | | Northwind | |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| | before | after | before | after | before | after |
| nearer the centre than their parent | 34.9% | **7.3%** | 32.1% | **12.7%** | 32.1% | **11.0%** |
| dead straight chains | 93.6% | **99.1%** | 94.6% | **98.7%** | 95.0% | **98.8%** |
| chains under a stranger | 2 | 2 | 16 | **1** | 45 | **12** |
| children touching their family | 86.2% | **87.2%** | 86.1% | **87.0%** | 86.5% | 86.1% |
| layout | 19ms | **15ms** | 412ms | **341ms** | 1,176ms | **1,145ms** |
| radius | 37 | 36 | 155 | 166 | 199 | 252 |

**The cost is width**, and it is real: +7% on the 1,000-person company and
**+27% on Northwind**, where the worst single offender also went from 28 tiles
to 50. Cohesion held everywhere and the layout got no slower. Northwind is the
weakest case on every line here, which is consistent — it is eleven rungs, and
accumulation is what the compass is fighting.

---

## The gap, read from one side only (2026-10-14)

Greg: *"the 5s placement feature bunches peer groups together."* It was
observing half of one rule. `reflow` asked *"is my own owed gap clear?"* and
never *"am I standing in somebody else's?"*, so the unit owed the least decided
every boundary it took part in — and a person is owed nothing.

Measured on the 1,000-person company, one five-second re-pickup of a
1,269-unit branch:

| | clean load | 5s re-pickup, before | after | tidy button |
| --- | ---: | ---: | ---: | ---: |
| units given the room the layout owes them | 134 | 21 | **110** | 133 |
| units squeezed | 85 | 198 | **109** | 86 |
| cells touching a stranger | 50% | 90% | **85%** | 48% |
| gap between sibling nodes, mean | 4.6 | 2.7 | 2.7 | 4.5 |

On the 45-person company it goes further than the clean load: squeezed **8 → 0**,
and every tile of owed room delivered.

The fix stamps each unit's owed ground as it is seated, so a candidate cell is
one lookup rather than a fresh search — the same idea as the atlas's `blocked`
and `halo` sets, which is why the atlas never had this fault.

**It is two-thirds of the problem, not all of it.** Sibling *node* spacing is
untouched at 2.7 against the load's 4.6, because `reflow` seats one node at a
time and reserves nothing for that node's family: two sibling teams are placed a
respectable distance apart and then their people grow into the space between
them and interleave. The atlas measures each child's whole subtree first and
reserves a disc; `neaten` moves whole branches and measures the clear ground
round the whole body. `reflow` is the only one of the three that cannot, and the
answer is to retire it — see `docs/TASKS.md`.

### A latency finding, unrelated and worth knowing

`placeIsland` is called on **every pointer move** during a drag. On the
1,000-person company, dragging a 1,269-unit branch inside the armed five-second
window costs **170ms per pointer move** — six frames. This predates all of the
above and none of it made it worse. Small branches are 2ms.

---

## The flung node, and a frontier (2026-10-14, evening)

Greg, after the compass landed: *"its faster and sometimes less buggy, but
sometimes we're still getting wild deviations. When moving a medium cluster,
occasionally one node will get flung out, or we'll end up with something that
looks like digital spaghetti in the connection lines."*

### Measuring the wrong thing, three times

Most of the evening went on this, so it is worth writing down plainly.

**"More than three tiles from its parent"** — the first metric. It said the
spacing fix had doubled the fault (3.0% → 6.5%). Inspecting the worst cases
showed they were nearly all **anchors**: the node the hand is holding, sitting
exactly where the clean load had already put it. A big division has to clear its
siblings' whole territories, so sitting far from its parent is the rule working.

**"Further from its parent than its own owed room explains"** — better, and
still wrong, for the same reason: a unit's distance from its parent is set by its
*siblings'* sizes, not only by its own gap.

**"Touching neither its parent nor any sibling"** — wrong in the most expensive
way, because it looks right. A unit owed four tiles of clear ground is **meant**
to sit four tiles out, so touching and well-spaced are opposites. Every attempt
to improve this number made the spacing worse, and that was not a coincidence —
it was the same quantity measured with the sign flipped.

**What works: distance to the nearest of parent-or-sibling, less that unit's own
owed room.** Lost means further out than your own clear ground explains. On that
measure the clean load sits at 4.2% and a five-second re-pickup at 5.6%, with
the worst case 7 tiles.

### The frontier, and why tuning cannot cross it

Before finding the right metric, four separate mechanisms were tried against the
wrong one. All four failed the same way, and the pattern is the useful part:

| what was tried | flung | spacing |
| --- | --- | --- |
| clamp how far a unit may travel for its gap | better | collapses |
| grade the gap breach instead of yes-or-no | no better | shares room out |
| price the two laws against each other | slides | slides |
| gate on touching family, as the atlas does | 3.4% | collapses |

Every one slid along a single line: **cohesion bought bunching, and spacing
bought flinging, with nothing in between.** The ranking applied literally — Law 2
strictly above Law 4, the family price set above the gap price — produces the
worst bunching of all: units given their owed room fell from 115 to 1.

The reason is structural and is the same finding as the morning's. **The atlas
grows the ground to make room; `reflow` has to fit a branch into the hole that is
already there.** For `reflow` the two laws compete for the same cells, so no
weighting between them can satisfy both. That is the argument for retiring it —
see [TASKS.md](TASKS.md) — and it is now evidence rather than opinion.

Two of the dead ends are worth their own note:

- **Grading the breach** (how far into somebody's ground, not merely whether) is
  the right idea and shares the room out measurably better — total clear ground
  delivered went 452 → 530. It also costs the early exit, because a maximum
  cannot be known until the whole disc is scanned: **2.4 seconds per pointer
  move** on the 1,000-person company against 170ms. It belongs with an engine
  that can afford it.
- **A ring-slack break**, the trick `territory.ts` uses, cut that to 112ms and
  took the room delivered down to 20 of 851 owed. Fast and useless.

### What landed: repair the tail, leave the policy alone

Greg said *"occasionally **one** node"* — an outlier, not a distribution. So the
search is untouched and `reflow` ends by fetching home anybody genuinely lost.

It is safe in a way none of the tuning was: a unit further from its family than
its own gap explains has **already** lost Law 2, so moving it cannot cost
anything a higher law ranks. It is fetched back to a cell at about its owed
distance — where the layout wanted it — rather than jammed against its relatives,
which is what made the touching-based version flatten every gap on the branch.

| | 45-person | | 1,000-person | | Northwind | |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| | before | after | before | after | before | after |
| lost by more than a tile | 16 | **1** | 52 | **0** | 104 | **5** |
| lost by more than three | 3 | **0** | 32 | **0** | 50 | **1** |
| worst case, tiles | 0 | 0 | 7 | **1** | 10 | **0** |
| clear ground delivered | 40 | 40 | 452 | 397 | 268 | 239 |
| cells touching a stranger | 69% | 69% | 81% | 81% | 94% | 94% |
| nearer the centre than their parent | 12% | 14% | 11% | 11% | 26% | 27% |
| one pointer move, big branch | — | 5ms | 170ms | 240ms | — | 665ms |

The flung node is gone on every company. The cost is some clear ground on the
1,000-person company — 452 tiles delivered down to 397, and units getting their
gap in *full* from 115 to 74 — while the measures that track what the eye reads
as bunching, cells touching a stranger and sibling spacing, do not move. The
pointer-move cost rises by about 40%, on top of a figure that was already too
high before any of this; see the task.

---

## Teams became real, and chains learnt to pass behind (2026-10-15)

Two changes, both from Greg, both aimed at the same screenshot.

### 1. The five-second gesture asks the atlas

Greg: *"I think we need to have the code understand what a team is, so that it
can calculate the best shape and protected periphery of it… Teams should be — to
the extent possible — sticky, ie people in the same team should glue together
where space allows, and where space doesn't, the whole team should move, rather
than isolate one human."*

**What a team looked like before.** On a clean load the atlas is perfect: all 230
teams on the 1,000-person company in one connected piece, every person **exactly
one tile** from their team node, nobody adrift. Not 99% — all of them. It manages
that by measuring a team and reserving its ground *before* placing anybody.

**What the gesture did to them.** `reflow` has no measuring pass, no reservation
and no idea what a team is — it walks the company one unit at a time asking
*"what is the nearest cell to your parent that satisfies your spacing?"*
Instrumented over a whole-company re-tidy, **55% of units found a legal cell at
an average of 3.9 rings from their parent** (it should be 1), and the other
**45% found nothing legal within sixteen rings and gave up**, taking whatever was
nearest. Those two numbers are both of Greg's complaints from one cause: the 45%
make the compression, the 55% make the broken teams.

The reason the near cells were refused is worth keeping: as the upper rungs are
seated, each division stamps a halo of reserved ground up to twelve tiles wide,
and a person is refused any cell inside a halo belonging to a division that is
not their own. In the compressed re-laid map those halos overlap nearly
everything, so the ground beside a person's own manager usually belongs to the
division next door.

**The fix is to stop `reflow` doing it.** `relayBranch` hands the subtree to
`layoutTerritories` — the same engine, the same two passes — rotated to grow away
from home and handed the company's own compass so it keeps facing the way it
always faced.

| | 45-person | | 1,000-person | | Northwind | |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| | reflow | atlas | reflow | atlas | reflow | atlas |
| teams in one piece | 74% | **100%** | 73% | **100%** | 40% | **100%** |
| teams with nobody adrift | 89% | **100%** | 81% | **100%** | 53% | **100%** |
| person → their team, mean | 1.64 | **1.00** | 2.46 | **1.00** | 3.53 | **1.00** |
| worst | 6 | **1** | 16 | **1** | 16 | **1** |
| span | 30×23 | **26×32** | 82×89 | **174×152** | 112×99 | **285×277** |

**Every figure after the gesture is now identical to a clean load** — span,
cohesion, curl-back, teams. Re-tidying a branch gives you the layout the engine
would have chosen, which is what it always should have meant.

**And it is far cheaper.** A branch's own shape does not change as the hand
moves, only where it lands, so the atlas runs **once** when the gesture arms and
after that carrying the branch is a translation: **1ms per pointer move against
`reflow`'s 256ms.** `restBranch` offers the body the cell under the hand, then
rings outward, and takes the first offset where every one of its cells is free —
so a branch that cannot fit settles nearby **whole** rather than seeping into the
gaps.

**Two bugs found on the way.**

- *The gesture refused its own natural form.* A landing was only worked out once
  the pointer crossed into a different cell. Picking a node straight back up and
  setting it down where it already was — which is the whole five-second rule —
  never leaves its own cell, so the release found no landing and refused the drop
  with *"there is nowhere free nearby"* on a nearly empty map. An armed pick-up
  now has its answer before the hand moves.
- *A skewed bearing.* The direction away from home was read straight off `q` and
  `r`. `cellToWorld` scales the two axes differently — `(1.5q, √3(r + q/2))` — so
  the angle was wrong by a little every time.

### 2. Chains may pass behind a colleague, and are faded where they do

Greg: *"we need to make it so that chaining can run behind existing colleagues —
perhaps by fading the colour of the connection line."*

Those are one idea. Running behind somebody cost **260** — twenty-six steps of
detour — which made it a thing to avoid at nearly any price, and avoiding it is
what drew the switchbacks: a chain that may not pass behind has to go *round*,
and the detour is paid in distance, which is the thing the eye follows.

At **30** — three steps — a chain steps behind one tile rather than walking four
round it, and still takes open ground when open ground is close:

| | 1,000-person | | Northwind | |
| --- | ---: | ---: | ---: | ---: |
| | before | after | before | after |
| dead straight | 98.7% | **100%** | 98.8% | **100%** |
| detouring | 0.9% | **0%** | 0.6% | **0%** |
| chains passing behind a tile | 1 | 45 | 12 | 125 |

It is only acceptable because it is **drawn** as passing behind. `runsOf` cuts a
walk into the stretches that are behind somebody and the stretches in the open —
sharing boundary cells, or the line would come apart into dashes at every tile —
and the lab draws the hidden ones at `BEHIND_ALPHA`. A line that crosses a tile
at full strength reads as going *through* it, which is the thing that looks like
tangle; faded, it reads as going behind, and the eye drops it and picks it up on
the far side.

**It does not shorten the longest chains.** 103 steps on Northwind, unchanged.
Those are long because a unit's node sits in the middle of its own territory
rather than at its door — a placement fault, written up in
[MAP-REVIEW-2026-10-15.md](MAP-REVIEW-2026-10-15.md). The fade makes them
legible; it does not make them short.

### A measurement mistake worth recording

Every probe in this session's first half built its tree with
`buildOrbitalTree(org)` while the lab builds it with
`{ mergePassThroughRoot: false }`. On the small company that is a five-unit tree
against a three-unit one. The numbers above were all re-taken with the lab's own
option and did not move, but they could have, and the next probe should start
from how `HexLab` builds its tree rather than from the default.

---

## The radial driver — ragged rings (2026-10-16)

Greg: *"We're going to try and implement a radial layout for the hex study…
concentric toruses comprised of shaded hexagon zones offset from master-center."*
Six requirements, discussed before any code. The governing choice he made, asked
to pick between two readings of his own requirements 4 and 5:

> **Ragged rings** — each branch stacks its own bands outward from its parent,
> concentric where the company is balanced and ragged where it is not.

The alternative, **shared rings**, would have given every branch one global set
of band radii — a true dartboard, where the fattest branch at each rung sets the
width for everybody. Requirement 4 (*"offset from master-center"*) pointed at it
and requirement 5 (*"should tend toward toruses… shouldn't force the thing"*)
pointed away, which is why it was worth asking rather than guessing.

### What it replaces

Exactly one thing: `placeChild`, the atlas's scored search over candidate
offsets. That search is 66–68% of layout time and, per
[MAP-REVIEW-2026-10-15.md](MAP-REVIEW-2026-10-15.md), the common factor behind
nearly every fault reported since 3 October. Everything else is kept — the two
passes, the territories, the compass, the spacing rule. A unit's position is now
two numbers that are never searched for: its **band** (its parent's owed
clearance plus one) and its **arc** (a slice of its parent's, shared by subtree
weight). The only question left is which cell of that band falls in that slice.

### A rung is a band, not a ring — counted before anything was written

| | units | rungs | one ring per rung holds |
| --- | ---: | ---: | ---: |
| Northwind, teams | 394 | 11 | 397 |
| Northwind, people | 2,957 | 20 | **1,261** |
| 1,000-person, people | 1,273 | 16 | **817** |

A hex ring *n* out holds exactly 6*n* cells. The teams view fits a strict
dartboard by luck and with nothing left over for spacing; the people view misses
by more than half. So a rung has to be a band with thickness — which is why
Greg's word was *torus* — and a band grows outward until it has the cells.

### Measured against the atlas, same companies, same renderer

**Teams view — radial wins on every line.**

| Northwind, 394 units | atlas | radial |
| --- | ---: | ---: |
| layout | 60ms | **3ms** |
| nearer the centre than their parent | 23.2% | **0.0%** |
| touching their parent | 42.7% | **56.0%** |
| families in one piece | 59/130 | **87/130** |
| radius | 90 | **60** |

**People view — faster, far more compact, shorter chains; behind on adjacency.**

| Northwind, 2,957 units | atlas | radial |
| --- | ---: | ---: |
| layout | 1,071ms | **22ms** |
| nearer the centre than their parent | 11.0% | **10.8%** |
| touching their parent | **83.7%** | 74.8% |
| mean chain | 2.13 | **1.73** |
| longest chain | 103 | **18** |
| families in one piece | **1,530/1,686** | 1,388/1,686 |
| radius | 252 | **84** |

The radius figure is the one to dwell on. The paragraph at the top of this file
records that the atlas covers *more* ground than the layout it was meant to
replace — 69,419 × 43,498 against the orbital map's 39,842 × 57,611. Radial is
the first thing in this study to take that back: a third of the atlas's radius,
about a tenth of its area, on the same company.

**Wide fans stop being the limit this study found.** With arcs shared by subtree
weight, a parent's cells arrive in proportion to what it has to hold. On a
fixture with 80–100-wide spans the hardest parent has 86 children, owns 65% of
the circle, and its band offers 85.7 cells — it self-balances at the wide end.
Children no longer need to be *next to* their parent, only on the next band at
its bearing, so the five-children ceiling (24% adjacency at span 20) does not
apply. This was the case MAP-REVIEW said to test before committing.

### Four faults found by measuring, and what each cost

Recorded because each one looked like a design problem and was arithmetic.

1. **Reach was accumulated.** A unit's reach was its clearance plus one plus its
   widest child's — which compounds at every rung, exactly as the orbital
   engine's descendant envelope did in September, and compounded straight into
   the spacing rule because a gap is a share of a size. Every clearance pinned to
   the `MAX_HALO` cap, chains averaging 15 cells, the map three times too wide.
   Fixed by reading size off the lattice: the smallest radius whose disc holds a
   subtree's weight. A count of units cannot compound.
2. **Arcs collapsed.** Shared by weight with no floor — which `headings`' own doc
   warns about in so many words, and which this driver had to learn again.
   `ARC` and `FLOOR` are now exported from `compass.ts` and read from there.
3. **The seating slice was not floored either.** Ring 1 has six cells 60° apart,
   so a slice narrower than that contains none of them — and the band thickened
   looking for one, with a free cell sitting right beside it. 40% of units
   touching their parent, 965 of 1,686 families whole.
4. **The parent's clear ground was reserved against its own people.** The halo
   exists to keep other territories out; reserving it against everybody put a
   team's people outside their own team's air. Law 3's doorstep clause is the
   authority, and the atlas reads it the same way.

And one that was a misreading of a law rather than a mistake in arithmetic:
**Law 3 was gated on size rather than on personhood.** *"A team, or anything
above a team"* may not sit nearer the centre; *"an individual person is pushed
outward, never forbidden."* Deciding both from the subtree weight reads that as
*"a small thing may curl inward"*, and a team with no people under it weighs one.
On the wide-fan fixtures it measured 25–29% curl-back against under 11% on the
demo shapes. The `people` set is the only thing that knows a person is a person.

### What it does not do yet

**It does not read as concentric rings**, and that is the honest state of it.
Looked at on all three companies, the placement is sound and the regions are
cohesive, but the master centre sits at the end of a spine rather than in the
middle of a target. Two causes, neither tuned at:

- The top rungs are three to seven units wide, so the first band is a sparse
  fan rather than a ring, and the company's mass lands on one side of it.
- **The shaded zones and the bubbles are not built at all.** Requirements 4 and 6
  are half placement and half drawing, and only the placement half exists. A
  bubble is cheap on a lattice — dilate a group's cells by one ring and hand them
  to `outline`, which already exists and already has the test that matters — but
  nothing draws one yet.

**Two decisions are waiting on Greg**, both recorded in [TASKS.md](TASKS.md): what
a bubble does to the spacing rule, and whether the people view's nine points of
adjacency are worth the tenfold compaction.

### Where it lives

```
lib/map/layout/hex/
  spacing.ts   one measure of distance, read by both drivers      ~165 lines
  compass.ts   a bearing for every unit, before anything is packed ~165 lines
  radial.ts    bands and arcs — the driver Greg chose              ~575 lines
  territory.ts the atlas, and the one entry point for both       ~1,120 lines
```

`spacing.ts` and `compass.ts` moved out of `territory.ts` unchanged. Both had to:
two drivers importing one another is a cycle, and two drivers each holding the
spacing rule is the fault Law 4 was written against. **Law 4 is now structural
rather than conventional** — there is nowhere else to put a spacing number, and
a reviewer can tell whether a file holds one by looking at what it imports.

---

## Bubbles, and what they found (2026-10-16)

Greg's requirements 4 and 6, built the same day as the driver. **They read as two
features and they are one object.**

> *"Concentric toruses comprised of shaded hexagon zones offset from
> master-center."* (4)
>
> *"These regions move with the nodes they pertain to — they form a 'bubble'
> around a group of teams… A bubble is taken as the shape of the contained node
> then offset wider by one hexagon spacing."* (6)

A zone is *the ground a branch holds*; a bubble is *that shape, grown by one*.
Those are the same cells, and the only difference is where the cells happen to be:

- **On a radial load** a branch's cells lie in a band crossed with an arc, so its
  bubble is an annular sector, and the bubbles of one rung side by side are the
  torus. **The concentric reading is not drawn, it emerges** — which is why
  requirement 5's *"shouldn't force the thing"* costs nothing. Where a branch has
  too few units to reach round, its bubble stops and the torus has a gap in it.
- **After somebody rearranges the map** the same rule gives the same answer about
  wherever the cells now are. Requirement 6's *"these regions move with the nodes
  they pertain to"* needs no code at all, because a bubble is read off live cells
  every time. There is a test that says so, since "no code" is only trustworthy
  if something checks it.

So `bubbles.ts` is deliberately the dumbest thing that satisfies both: take the
cells, grow them by a ring, draw the edge. Nothing is remembered between loads.

**Above team level only**, on Greg's instruction — *"so the spacing rule doesn't
move"*. A bubble one cell out needs two clear cells between neighbours, and two
sibling teams have one.

### What drawing them found

**Radial reserves air between a parent and its children and none between
siblings.** The clearance is a radius; the arcs that hold siblings apart are a
direction, and a direction is not a distance. Measured on the 1,000-person
company, sibling bubble pairs whose skirts overlap:

| | overlapping | of | sibling nodes within 2 cells |
| --- | ---: | ---: | ---: |
| atlas | 2 | 15 | 0 |
| **radial** | **14** | 15 | **11** |

It is Greg's oldest complaint about this engine — *"the 5s placement feature
bunches peer groups together"* — arrived at from a new direction, and the bubbles
are what made it visible. Two things were tried:

- **Applying the shared spacing rule node-to-node.** Halved the sibling nodes
  sitting within two cells (11 → 5) and moved the overlap by two (14 → 12),
  because **a bubble covers a subtree and the gap was measured between nodes**.
  It also cost twenty whole families on Northwind, 87 → 67. **Reverted**: Law 2
  outranks Law 4, and a spacing preference is not allowed to break bodies.
- **Clipping the skirt off other people's nodes.** A bubble may not swallow a
  node from outside its own branch, so it hugs tight where there is no room and
  bulges where there is — requirement 5 applied to the offset rather than to the
  ring. 14 → 10, and **kept**, because it is a drawing rule and moves nothing.

**The real fix is reserving each sibling's whole footprint before placing it**,
which the atlas does and radial does not. That is a piece of work rather than a
tweak, and it is in [TASKS.md](TASKS.md).

### Drawing them

131 bubbles over 37,000 cells on the largest company, built in about 30ms — once
per arrangement, memoised, never in the frame loop. Each becomes one `Path2D`,
so a region is one fill call rather than tens of thousands.

**A bubble fades in with its size on screen rather than switching on.** Drawn
flat, every rung's bubble is painted at every zoom — twelve nested on Northwind —
and the overview becomes a thicket of boundaries with no hierarchy in it, which
is the confetti fault wearing a new coat. A hard cut-off instead makes regions
pop in and out as the camera moves, which is worse. Nothing under 48px, full
strength by 160px: at overview only the divisions carry a line, and the teams
arrive as you come down to them.

One bug worth not repeating: **a client component is still rendered once on the
server, where there is no `Path2D`.** The lab 500'd until the memo learnt to skip
that pass.

---

## Separating siblings — what was tried, and why it did not work (2026-10-16)

Greg, after the bubbles made the fault visible: *"reserve each sibling's whole
footprint before placing it, probably by widening a child's arc by what its
subtree will need."*

**Built exactly that. It does not separate them.** This section is the record,
because the next person to look at this will have the same idea.

### What was built

Arcs are now sized from the **footprint a subtree will occupy** rather than from
its raw weight, and the band thickens when a rung's regions do not fit. The
arithmetic is the lattice's and is two cell counts over each other: a ring `R`
out holds `6R` cells, so one cell of it is `1/6R` of a turn, and a child whose
subtree packs into a blob of radius `b` with its node on band `R` claims about
`(b + ½)/(R + b)` either side of its bearing, plus half the clear ground it is
owed. No circumference, no π.

### The sweep, on Northwind with people as the smallest unit

`thicken` is how many rings a crowded rung may push its regions outward.

| thicken | touching parent | families whole | curl-back | radius | **overlapping sibling bubbles** |
| ---: | ---: | ---: | ---: | ---: | ---: |
| **0** | 76.0% | 1,405/1,686 | 12.2% | **97** | **27** |
| 1 | 74.5% | 1,366 | 15.1% | 97 | 37 |
| 2 | 77.7% | 1,410 | 13.5% | 114 | 35 |
| 4 | 78.2% | 1,418 | 13.4% | 118 | 32 |
| 8 | 80.5% | 1,464 | 12.2% | 180 | 48 |
| 16 | 82.5% | 1,503 | 9.7% | 255 | 56 |
| 64 | 83.5% | 1,515 | 8.6% | 764 | 52 |

**The overlap gets worse as the rung gets thicker**, which is the opposite of
what the idea predicts and is the whole finding. Pushing a crowded rung outward
buys each subtree room to sprawl *sideways* into its neighbour's ground, so
separation falls while width rises almost in proportion. Two other formulations
were measured and rejected for the same reason:

- **Holding sibling *nodes* apart** by the shared spacing rule. Halved the
  sibling nodes sitting within two cells and moved the overlap by two, because
  what overlaps is bodies and not nodes. Cost twenty whole families; reverted,
  since Law 2 outranks Law 4.
- **Thickening until each slice is at least one cell of its ring.** Took the
  overlap from 10 to 11 on the test fixture. No effect worth the name.

### What was kept, and why

The dial is kept and **set to nought**, because what it actually buys is a real
trade somebody may want: **cohesion against width**, 76.0% of units touching
their parent at a radius of 97 against 82.5% at 255. It is a dial on one rule
rather than a second rule — it only decides which band the one spacing figure is
applied on.

The footprint arithmetic is kept because it is the right foundation and it pays
for itself slightly: against the previous version, on the same company, 76.0%
touching against 74.8%, 1,405 whole against 1,388, 27 overlapping bubbles
against 32 — at a radius of 97 against 84 and curl-back of 12.2% against 10.8%.
A wash, honestly, and it is kept for the shape of it rather than for the numbers.

**One flat number did go**, and should have gone earlier: the arc floor was 60°
at every rung, which is one cell on ring 1 and **ten** on ring 10. It is now one
cell of the ring the unit is actually standing on. That is what the standing
requirement in [MAP-LAWS.md](MAP-LAWS.md) means by *"a ring is a ring of cells"*,
and the flat version is why subtrees spilled over their neighbours at every rung
but the first.

### A Law 1 bug the sweep found

At a high `thicken` the panel went on reporting healthy ratios while the driver
placed **21 of 2,957 units**. `BAND_LIMIT` was an absolute ceiling, so a unit
whose band already began past it searched *no rings at all* and was reported
unplaced — and every percentage on the panel was a ratio of what was left, which
says nothing about what is gone. It is now `BAND_REACH`, counted from the
starting band. It never fired at the settings the map ships with.

**The lesson is the measuring one, not the arithmetic one.** A sweep that moves a
parameter far past its normal range is worth running precisely because it breaks
things that look fine in the working range, and *"placed"* belongs next to every
ratio on the panel for the same reason.

### Still open

Separating sibling bodies in radial is **not solved**. The atlas does it by
packing an exact shape and reserving the ground, which is the search this driver
exists to delete, so the answer is not simply to copy it. See [TASKS.md](TASKS.md).

---

## It was a drawing question (2026-10-16)

Greg, after three placement attempts had failed to separate sibling regions:
*"two regions sharing a border may be what an atlas should look like. Try it in
how the boundary is drawn."*

**That is the answer, and it makes the problem disappear rather than shrink.**

### Partition the skirt instead of duplicating it

Grown independently, two neighbouring regions both claim the cells between them:
their washes double into a dark seam and each draws a boundary *through* the
other's ground. Countries do not do this. They meet at a line that belongs to
both and is drawn once.

So the one-ring skirt is **partitioned**. A contested cell goes to whichever
region already surrounds it more — the eye reads a frontier as the place where
one region stops surrounding you — with ties broken by name so the picture stays
a pure function of the company. Nesting is not a contest: a child's ground is
inside its parent's by construction, so an ancestor of the winner keeps the cell
too. Only unrelated regions compete.

| cells held by two unrelated regions | before | after |
| --- | ---: | ---: |
| Digital Tailoring-ish · people | 0 | 0 |
| 1,000 · people | some | **0** |
| Northwind · teams | some | **0** |
| Northwind · people | some | **0** |

Overlapping sibling bubble pairs on the 1,000-person company go from **10 of 15
to nought** under radial, and 2 to nought under the atlas. Three attempts at
moving the units never got below about two thirds of pairs.

### A frontier is not a coastline

With the regions tiling, the two outlines that meet along a shared border lie on
exactly the same edges — one line, drawn twice, in the right place. That is what
lets each be drawn for what it is:

- a **coastline** says *this is where the company stops*, and is the region's own
  edge in the region's own hue;
- a **frontier** says *this is where Sales stops and Delivery starts*, belongs to
  both sides equally, and is drawn in neutral ink rather than in either one's
  colour.

Classifying an edge is done by its **midpoint**, which is halfway between the two
cell centres and needs no knowledge of how corners are ordered. Deliberately:
`outline`'s corner-to-direction mapping was wrong for all six directions once, in
a way that survived counting, and the test that caught it derives the answer this
same second way. Re-deriving the mapping to classify edges would be
re-introducing the identical risk.

### How much of a boundary is frontier turns out to describe the drivers

Northwind, teams view:

| | frontier edges | coast edges | frontier |
| --- | ---: | ---: | ---: |
| atlas | 41 | 11,775 | **0.3%** |
| radial | 1,211 | 4,305 | **22.0%** |

**The atlas draws islands with sea between them; radial draws a continent of
countries that meet.** That is not decoration — it is the clearest single
statement of the difference between the two, and it is an argument for radial
that none of the cohesion numbers made: an atlas is a thing with borders in it.

### What it cost

Building the bubbles went from about 30ms to 50ms on the largest company under
radial, and 58ms to 118ms under the atlas — once per arrangement, memoised, never
in the frame loop. The partition is the extra work and it is worth it.

### What this does *not* mean

**The placement fault is still real and still open.** Sibling regions in radial
genuinely sit closer together than the atlas's do, and the drawing now handles
that gracefully rather than fixing it. If the map later wants real air between
regions — for labels in the gap, say, or for a region to be grabbable by its
margin — that is still the reserving-the-footprint problem, and the sweep above
says thickening is not the way to it.

---

## The spacer rule, and the borders coming off (2026-10-16)

Greg, on the first map with bubbles on it: *"this looks like an illustration
you'd find in Neuromancer."* Two things, and the second is a rewrite.

### The borders came off

*"There are borders around the bubbles — they don't need to be there."* They had
been there for an afternoon, drawn as an atlas draws them: a coastline in the
region's own hue and a frontier in neutral ink. The wash alone carries a region,
and twelve nested outlines carried a thicket. **The measurement survives the
code**, and it is worth keeping: on Northwind's teams view the atlas driver's
regions are **0.3% frontier** and radial's are **22%**, which is the difference
between islands with sea between them and a continent of countries that meet.

### The spacing rule became a touching rule

*"All nodes — human and structural — have a one hexagon space around them. That
is to say, each side of the hexagon representing that human or node gains a
connecting hexagon that forms its spacer. On load, or using the auto-tidy
function, the only things that can enter that node or human's spacer hexagons are
humans in the same team or humans that are direct children of a structural
node."*

**This is the fifth attempt at separating regions and the first that works**, and
the reason is in the grammar rather than in the numbers. The four before it were
distances — a gap by rung, a gap by size, sibling nodes held apart, footprints
reserved as arcs — and a distance has two parties with opinions about it, which
is how one boundary came to be settled by whichever unit was owed the least. A
touching rule is a property of the pair. `mayTouch(a, b)` and `mayTouch(b, a)`
are the same question.

Three things fall out of it that nobody asked for separately:

- **Two structural nodes are never adjacent.** Neither is a human, so neither may
  enter the other's spacer. Divisions, portfolios and teams get their clear
  hexagon without a number anywhere in the engine.
- **Two humans touch only if they share a team**, so a team is one connected
  crowd with clear ground round it — *"teams should have one hexagon of clear
  space between them"*.
- **A human touches a structural node only if it is theirs**: their own team, or
  the node they report to directly. The lead stands at the door, which is Law 3's
  own clause, and nobody else's people do.

A human's team is their nearest structural ancestor, so the rule needs no new
data: the `people` set says who is human and the tree says the rest.

### Measured

Spacer breaches — pairs of adjacent units that may not touch — counted from the
drawn arrangement:

| | atlas | radial |
| --- | ---: | ---: |
| Sparrow-ish · people | 1 of 43 | **0 of 35** |
| Digital Tailoring-ish · people | 2 of 177 | **0 of 174** |
| 1,000 · people | 16 of 1,961 | **0 of 1,688** |
| Northwind · teams | 340 of 340 | **0 of 0** |
| Northwind · people | 25 of 4,336 | **0 of 3,754** |

The atlas breaches it everywhere, which is expected — it does not know the rule
and never has. On Northwind's people view the panel's own figure went from
**2,266 of 2,562 people sitting next to somebody from another team to nought**,
and curl-back to **0.0%** on every company.

**What it costs is width, and less than expected**: Northwind's people view goes
from a radius of 84 to 100, against the atlas's 252. The teams view goes from 60
to 52 — it got *smaller*, because a rule that forbids adjacency outright is a
cheaper thing to satisfy than a search that was trying to achieve it by distance.

**A statistic that now measures the rule.** In the teams view every unit is
structural, so *"families in one piece"* reads 0/130 — a family cannot be one
connected patch when the rule forbids its members from touching. The number is
not a failure, it is the rule, and it is the third time this engine has produced
a statistic that measures its own instruction. It wants replacing with *"is every
unit where the rule put it"*, as `spacedBy` was.

### Tidy had to learn it too

*"On load, **or using the auto-tidy function**."* Tidy did not know the rule and
was measurably a second placer: on a radial load with nought breaches, one tidy
produced **14** on the 45-person company and **245** on the 1,000-person one.

Both of its phases had to learn it. Teaching only the gather left **94** of the
245 — all of them turns, because rotation keeps a branch's shape exactly and so
cannot break the rule internally, but it changes which way the branch faces the
world, and that is where it meets strangers. With both taught: **0 and 2**. The
two that survive are where a gather and a turn interact, and they are on the
record rather than rounded away.

`neaten` takes the `people` set as an optional argument, so tidy under the atlas
driver behaves exactly as it did before — the atlas does not hold to this rule.

---

## Likeness, and the re-pickup catching up (2026-10-16, later)

Greg added four rules and asked whether they contravened the laws. Three fitted;
two needed a decision from him, and he made both.

### What he decided

- **A plain drop does not re-lay the branch it is holding.** Asked whether
  dropping should lay a branch out properly the way the five-second re-pickup
  does, he chose *"only on consent"*. So Law 0 stands as written — *"a person's
  placement is never improved on the engine's own initiative"* — and re-laying
  stays behind the re-pickup and the tidy button, where aiming at it is the
  consent. The cost is that a dropped branch can interlock with its new
  neighbours until somebody tidies.
- **Alike means closeness on the tree, for now**, moving to real fields later.

### The five-second re-pickup was still the atlas's

Which made the decision above matter more than it looked. `relayBranch` called
`layoutTerritories` whatever the map had been laid out with, so a branch picked
up on a radial map came back packed the atlas's way — and therefore **without
the spacer rule**, because that rule lives in the radial driver. Measured inside
the re-laid branch: 2 breaches on the 45-person company and 16 on the
1,000-person one, against nought on a clean load. It now takes the driver, and
both go to nought.

**Its remaining limit, stated rather than fixed:** a branch is re-laid in its own
frame with its own empty ground, so the rule is guaranteed *inside* the branch
and not along the boundary where it meets the rest of the map. Tidy is what
settles that boundary.

### Likeness: the property holds, and the inversions have no lever

*"The more alike a team or node is, the closer in space they should fall."*

**On average it already holds.** Mean distance in cells rises with every step of
tree distance, under both drivers — it falls out of the nesting rather than being
aimed at, because a subtree owns an arc.

| tree distance | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cells apart, 1,000-person, radial | 2 | 6 | 9 | 12 | 14 | 17 | 20 | 21 |
| cells apart, 1,000-person, atlas | 1 | 10 | 13 | 16 | 23 | 31 | 36 | 41 |

**Pair by pair it does not**: 22–35% of individual pairs invert, meaning a
tree-closer pair sitting further apart than a tree-farther one. Two levers were
tried against that and **both made it worse**:

| | medium | 1,000-person | Northwind teams |
| --- | ---: | ---: | ---: |
| as it stands | 22.2% | **34.7%** | **28.0%** |
| siblings clustered into the arc they need | 22.1% | 38.8% | 30.3% |
| heaviest child on its parent's own bearing | 24.1% | 38.4% | 30.4% |

Clustering siblings is the literal reading of *"peer teams should preferentially
place next to each other"*, and it backfires because the spacer already sets a
floor on how close two teams may be: narrowing their arc does not bring them
closer, it pushes them outward to find room. On Northwind's teams view it made
sibling pairs *further* apart, 6 cells to 7.

Putting the heaviest child on its parent's bearing is the atlas's own documented
grammar — *"the heaviest child continues its parent's street"* — and it broke
monotonicity at the first step: parent-to-child went to 7 cells while
sibling-to-sibling stayed at 6.

**Why neither works.** The inversions are dominated by **radial stretch**: within
a branch, distance grows with depth, while across an arc boundary two unrelated
units at the same radius can be neighbours. No sibling ordering touches that, and
the thing that would — packing branches tighter — is the spacer, which exists to
do the opposite. **The spacer rule and aggressive likeness pull against each
other**, and the spacer wins because Greg ranked it there.

That leaves the honest position: the property is held as a preference, asserted
on average by a test, and the pair-by-pair figure is on the record with no lever
behind it. Real fields are the next thing that would move it.

### Growing the space on a clash was already there

*"If the mapping produces a clash, grow the space so that the clash can be
resolved."* This is what `seat` does when every cell on a band would breach a
spacer: it walks outward a ring and asks again, which is the same mechanism as
the torus thickening. Measured at nought breaches on every company, so the growth
is always finding the room.

---

## Why chains still looped, and the number that was missing (2026-10-17)

Greg: *"we've somewhere implemented a radial version of the thing but I don't see
that showing up in how it's presented… descendants loop back on themselves on
the on-load presentation. What code do we have that's attempting to prevent this?
What is preventing that code from working?"*

He was right, and the panel had been telling him the opposite.

### The number that was missing

Curl-back — *"units nearer the centre than their parent"* — read **0%** on a
clean radial load, and that is true. It is also the wrong question. A rung that
goes neither in nor out still takes you **round** the centre rather than away
from it, and six of those is a circle.

Counted on the same clean load:

| | curl-back | rungs going round the centre | chains turning >90° | way home ÷ direct |
| --- | ---: | ---: | ---: | ---: |
| Northwind · people | 0% | **21%** | 6.0% | ×1.41 |
| Northwind · teams | 0% | **22%** | 13.8% | ×1.27 |
| 1,000 · people | 0% | **28%** | 5.8% | ×1.25 |

**This is the fourth time a statistic in this engine has measured the rule
instead of the map**, and the first where it hid a fault rather than invented
one. The panel now carries it: *"N% of rungs go round the centre rather than
away from it"*, counted live from what is drawn.

### What was meant to prevent it, and why neither did

**Law 3's gate**, in `seat`. It forbids a cell nearer the origin than the
parent — and Law 3 says, deliberately, *"equal distance is allowed; nearer is
not."* So sideways is legal by the letter of the law, and sideways is what
compounds. **This is the cause.**

**The compass** (`headings`), built in October for exactly this and *not called
by the radial driver*, which subdivides arcs itself. That was a suspect, and it
was tested: handing each child the slice it was **offered** (absolute, tracing
back to the root's own circle) instead of the direction it **landed** in
(relative, read back off the placement) moved rungs-round-the-centre from 21% to
22% and chains turning >90° from 6.0% to 4.2% — a wash. So the relative bearing
is a real wart but not the fault. The comment in `radial.ts` claiming the landed
direction is what *prevents* accumulation has it backwards and is corrected.

### Measured: forbidding sideways — now the default

Greg, with both in front of him: *"make strictly-out the default and update Law 3
to say sideways is forbidden for places."* Done; Law 3 is rewritten in
[MAP-LAWS.md](MAP-LAWS.md). The older rule stays reachable in the lab under
**rung → sideways ok**, because that is how the trade was settled and because a
switch that can still produce the fault is the only proof the fix does anything.

| Northwind · people | sideways ok | strictly out |
| --- | ---: | ---: |
| rungs going round the centre | 21% | **0%** |
| chains turning >90° | 6.0% | **2.2%** |
| mean turn per rung | 28° | **25°** |
| touching their parent | **75%** | 53% |
| families in one piece | **1,379** | 1,185 |
| mean chain | **1.7** | 3.2 |
| radius | **100** | 125 |

It fixes the loops outright and costs about twenty points of adjacency, because
a cell that is both free *and* strictly further out is a rarer thing than one
that is merely not nearer. **A person is unaffected as a matter of law** — Law 3
makes the near side a cost for an individual and not a wall, and the gate is
applied only to places.

### Tidy had to learn it as well

Rotation is what makes this tidy's problem and not only the driver's: a turn
keeps a branch's shape exactly, so nothing inside it moves relative to anything
else inside it, but **every member's distance from the master centre changes**.
Measured before tidy knew the law, one tidy on a clean load put back **3 of 12**
sideways rungs on the 45-person company and **7 of 164** on the 1,000-person one.

Both phases now check it, and both go to nought. It costs a handful of turns —
58 down to 52 on the 1,000-person company — and it incidentally took the last two
spacer breaches after a tidy to nought as well, which had been sitting there
since 2026-10-16.

### The other half of the complaint is not this

*"I don't see that showing up in how it's presented."* Separately from the loops,
**the master centre sits 45–63% of the radius away from the middle of its own
company** — measured against the centroid of every cell, under both settings and
both drivers. A map whose centre is halfway to the edge does not read as rings
however straight its chains are. That is the arc allocation and the shape of the
company, not Law 3, and forbidding sideways does not move it.

---

## How the stranded islands form (2026-10-17, later)

Greg, on the map after the Law 3 change: *"there are still archipelagos on load
and on auto-tidy, where there should not really be isolated members of the same
genealogy."*

**First, a correction to the premise.** There is no likeness weighting in the
engine. It was measured on 2026-10-16, two levers were tried — clustering
siblings, and the heaviest child on its parent's bearing — and **both made the
pair-by-pair figure worse and were reverted**. What exists is likeness holding
*on average* as a side effect of nesting. So the islands are not a mis-tuned
weighting; nothing is tuned.

### Three different things were being seen at once

Measured on Northwind with people as the smallest unit, counting connected
components of each coloured region exactly as the lab groups them:

| | pieces per region | teams in one piece |
| --- | ---: | ---: |
| atlas | 18.0 | **395 / 395** |
| radial, sideways allowed | 23.7 | 326 / 395 |
| radial, strictly out *(the default, 16 Oct)* | **35.6** | **207 / 395** |

**1. Most of it is the spacer rule, working.** A region's raw cells *must* come
apart, because two structural nodes may not touch and two humans may not touch
across teams — so every team is its own island by construction. Grow a region by
one ring, which is what its bubble does, and 35.6 pieces becomes **2.9**. The
continent is there; the per-cell wash just does not draw it.

**2. The rest was a bug I introduced**, and it is the one that matters. Making
rungs strictly outward was meant to hold *places* to Law 3 — *"a team, or
anything above a team"* — but the term reached the **ranking** as well as the
gate, so it pushed people too. Law 3 is explicit that an individual is *"pushed
outward, never forbidden"*, and pushing them that hard tore teams apart:
**188 of 395 teams in pieces, against 69 before.** A person who would have stood
beside their team on the level side was shoved to a further band, away from the
rest of their own crowd.

**Law 2 outranks Law 3**, so a Law 3 preference does not get to break a body.
The term is now gated to places. Measured:

| Northwind · people | before the fix | after |
| --- | ---: | ---: |
| teams in one piece | 207 / 395 | **327 / 395** |
| pieces per region | 35.6 | **23.8** |
| children touching their family | 75% | **81%** |
| families in one piece | 1,185 | **1,380** |
| radius | 125 | **106** |
| rungs (team and above) going round the centre | 0% | **0%** |

So the law is still kept exactly, and the cost it appeared to carry was mostly
this bug rather than the law.

**3. A panel figure that had flipped the other way.** *"N% of rungs go round the
centre"* counted people as well as places, and once people were correctly allowed
to stand level again it read **38%** on a map where every place was obeying. It
now counts team-and-above, which is who the law holds, and reads 0%.

### On the two constraints offered

- **"Remove any max length on connection lines."** There is nothing to remove —
  the engine has no maximum chain length. `BAND_REACH` is a search guard counted
  from a unit's own starting band, not a cap on how far a chain may run, and
  chains of 30-plus cells occur.
- **"Give family groupings breathing room of 3–5 spacing tiles."** This separates
  families from each other; it does not gather a family's own scattered pieces,
  which is what the complaint was about. Measured, growing a region by 3 rings
  takes it to 1.5 pieces — so it would help the *reading* — but it would also
  require reserving each family's whole footprint before placing it, which was
  tried on 2026-10-16 as footprint-as-arc and made things worse. Worth doing only
  if the fix above leaves the map still looking like an archipelago.

---

## Why a branch scatters, found properly (2026-10-17, evening)

Greg: *"there are 'landlocked' areas of one or two teams that are from one
branch, then another is on the other side of the map… the preferential-closeness
rule we've put in is not working as expected. I also do not see additional
spacing around family/branches."*

**He was right about both, including the part I had to correct twice:** there was
no preferential-closeness rule and no family spacing. Two likeness levers were
tried on 16 Oct, both measured worse, both reverted; the breathing room was
deferred. So nothing was mis-tuned — there was nothing there.

### What is built now

- **Siblings cluster.** Children take the arc they need, centred on their
  parent's bearing, and the slack is left empty. It used to be shared out in
  proportion to weight, which fanned a parent's branches across its whole sweep:
  the closest pair on the tree put as far apart as the arc allowed. Measured on
  Northwind, the worst sibling-branch separation at the top rung went **21 → 13**
  cells and at rung 2 **7 → 4**.
- **A `kin` gap**, default 3 tiles, between one branch and the next. Held as an
  angle, because `n` tiles at radius `R` is `n/6R` of a turn — so the family's
  footprint never has to be packed to know how much room to leave beside it.
- **`strayed`** on the panel: units seated outside the slice their family set
  aside. Every other figure is an average, and an average cannot show you the one
  team flung to the far side of the map.

Together: regions go from 500 pieces to 480, teams in one piece 327 → 332.
Modest, and they do not touch the thing Greg is pointing at.

### The thing Greg is pointing at

`strayed` reads **nought**. Every unit *is* inside its own slice. So the scatter
is not units being thrown — it is units **climbing**, and here is the worst case
on Northwind:

```
parent  Union Business Unit   depth 4   47 rings from the centre
  Aurora Team 217      24 rings from parent,  48 from the centre
  Meridian Function    25 rings from parent,  48 from the centre
  Willow Team 216      27 rings from parent,  48 from the centre
```

Three sibling teams, all one ring further out than their parent, and all
twenty-odd rings *around* the ring from it and from each other.

**The cause is that bearings are relative while Law 3 is absolute.** A child is
seated on a ring around its *parent*, in a slice measured as a bearing *from the
parent* — and since 17 Oct it must also be strictly further from the **master
centre**. When a parent's own bearing does not point away from the centre, its
children's slices point sideways, and a cell thirteen rings away in a sideways
direction is no further from the centre than the parent is. So it is refused, and
the unit climbs — twenty rings, until its sideways slice finally clears the
parent's radius.

The two rules are individually right and mutually frustrating, and no weighting
reconciles them because it is a geometric contradiction rather than a trade.

### Reserving the ground was tried and does not fix it

Greg: *"reserve each branch's wedge when its parent is placed, so later siblings
can't eat it."* Built: every child seated and its ground claimed before any
sibling is recursed into, the claim being an arc crossed with a range of rings,
sized by the annulus arithmetic rather than by a disc — a first cut used
`ringsFor(weight)`, which is the radius of a *disc* holding the subtree and
badly undersized for a long thin wedge: Meridian's 166 cells span 27 rings where
a disc would want 7, and an undersized claim is worse than none, because the
branch overflows it and then finds its siblings' claims in the way.

Properly sized it did help the symptom — coloured regions went from 480 pieces to
**387** — and it **halved team integrity, 332 of 395 teams in one piece down to
151**, because a sibling's claim covers ground a team's own people need. Law 2
outranks the lot, so it is reverted. The code is on the record here rather than
in the tree.

### What would actually fix it

**Anchor the arcs to the master centre instead of to the parent.** A unit's slice
should be its share of the *root's* circle — a bearing measured from the origin,
not from wherever its parent happened to land. Then "move outward" and "stay in
my arc" stop fighting: inside an absolute wedge, going outward always increases
the distance from the centre, so the climb disappears and a branch is a wedge of
the map by construction.

That is what `headings` has computed since 2026-10-14 and what this driver has
never used — it subdivides arcs itself, relative to each parent. The note in
`radial.ts` saying the relative bearing is a wart rather than a virtue was
written on 17 Oct and this is the bill for it.

It is a rewrite of `seat`, from *"a ring around the parent, bearing from the
parent"* to *"a bearing from the origin, a distance from the origin"* — the
honest polar placer this driver has been approximating. Not attempted here.

---

## Absolute arcs: the zoning fix, proved and not landed (2026-10-17, night)

Greg's three requirements — like groupings sticking together, more room every
few rungs above team level, and master-centre being *unappealing* rather than
forbidden — all point at the same change: **place in absolute terms from the
master centre** rather than relative to each parent. One rewrite serves all
three, and it was built far enough to prove the first.

### It fixes the zoning, and that is not in doubt

Granite Division's three children, measured as the angular spread of each
branch's whole subtree as seen from Granite:

| | span of each branch | overlap between them |
| --- | ---: | ---: |
| relative arcs (what ships) | 171°, 184°, 219° | **171°, 171°, 177°** |
| absolute arcs | 31°, 49°, 31° | **1°, 19°, 30°** |

Three clouds sharing one space became three wedges. That is Greg's *"prevented
from spacing out radially to take their own zoning"*, answered.

### It is not landed, and the honest reason is that I lost track of it

Two laws regressed badly on the first cut — the spacer to 1,249 breaches and
teams in one piece from 332 of 395 down to 48 — because a place could be seated
with nowhere for its own crowd to stand. Requiring room for the crowd and ranking
the fallback fixed both: **0 breaches, 309 teams**, at **23 seconds** on the
largest company.

Making it fast meant not asking the spacer about cells far outside a branch's
arc. That took it to 1.2 seconds and put the breaches back. Bounding the skip
rather than removing it did not restore them, and **with the skip effectively
disabled the breaches still did not return to nought** — 851 rather than the 0
measured twenty minutes earlier on what should have been the same code path.

That last fact is the reason this is written up rather than committed: the
measurements stopped reconciling, which means the thing was no longer understood.
Reverted whole.

### What a second attempt should know

- **The seater has to be rebuilt, not patched.** It currently searches rings
  around the *parent* with bearings measured from the parent. The absolute
  version searches rings around the *origin* with bearings from the origin, and
  the two cannot both be true of one function.
- **Checking the spacer is the cost.** A ring 120 out holds 720 cells and asking
  each one is a spiral apiece. Any viable version must narrow to the arc *before*
  it asks, and must do so without changing which cells are eligible — which is
  exactly where this attempt came apart.
- **A place must not be seated where its own people cannot stand.** Law 2, and
  the single most expensive thing to get wrong here: it cost 260 of 395 teams.
- **The ring schedule works and is cheap.** A floor per depth, each rung clearing
  the one inside it by its own ring plus a cell, is what makes the centre
  unappealing without forbidding anything — and it removes the sideways climb,
  because a unit beyond its floor may move freely at its own radius.

### What is kept from the attempt

`gapFor` and `leastApart` in `spacing.ts` — the spacer widened by rung, one more
hexagon every `RUNGS_PER_HEX` rungs above team level, which is Greg's second
requirement. They are written and unused: nothing reads them until a placer can
honour them, and wiring them into the current relative placer would widen gaps
the arcs cannot pay for.

---

## Absolute arcs, landed (2026-10-17, night)

The second attempt at the rewrite above. **It holds, and the numbers account for
themselves.** `npx tsx scripts/hexZoning.ts` prints every figure here.

### The headline: three clouds became three wedges

Granite Division's three children, measured as the angular spread of each
branch's whole subtree as seen from Granite, and how much of that spread they
share:

| | span of each branch | overlap between them |
| --- | ---: | ---: |
| relative arcs (what shipped) | 171°, 184°, 219° | **171°, 171°, 177°** |
| absolute arcs | 186°, 77°, 67° | **0°, 0°, 0°** |

That is Greg's *"prevented from spacing out radially to take their own zoning"*,
answered. Everest's own span stays wide because Everest **is** 43% of the company
and Granite sits inside its sector; what matters is that no two of them share
any ground at all.

### Everything else, Northwind with people as the smallest unit

| | relative (was) | absolute (now) |
| --- | ---: | ---: |
| spacer breaches, every company, both strata | 0 | **0** |
| teams in one piece | 332/395 | **395/395** |
| rungs at team level and above going round the centre | 0/394 | **0/394** |
| units touching their family | 81.0% | **84.7%** |
| units seated outside their own arc (`strayed`) | 0 | **0** |
| layout | 77ms | **52ms** |
| radius | 101 | 109 |
| median step home | 1 | 1 |
| mean step home | 2.35 | **2.28** |
| 99th percentile step home | 18 | 24 |
| longest step home | 32 | **51** |

Teams in one piece is the one to read twice: **every team on the company is now a
single crowd**, where 63 were in pieces before. And it is faster than what it
replaces, not slower — the honest reason being that a unit hugging its own family
inside its wedge walks fewer rings than one aiming at a wedge's centre line.

**The tail of the connection lines is what it costs**, and it is the only figure
that went the wrong way. Where a company is top-heavy — Northwind's root has one
child holding 2,955 of 2,957 units, whose own child holds 2,811 — a dominant
branch is handed almost the whole circle, so its two or three children fan right
round it and one of them can end up on the far side of the master centre. The
median and the mean are unchanged or better; the longest line went 32 cells to
51. Law 5 ranks lines last and this is what that ranking is for.

### What was built

1. **Absolute arcs.** The root owns the circle; every unit cuts **its own**
   interval among its place children in proportion to subtree weight, with the
   `kin` gap between them; a child keeps that interval and hands sub-intervals
   down. Computed in a pass of its own **before any cell is chosen**, which is
   the proof rather than the tidiness: a function of the tree cannot depend on
   where anything landed. The biggest child is laid in the middle of its
   parent's arc and the rest alternate outward, so the longest line belongs to
   the smallest branch — that alone took teams in one piece from 391 to 395.
2. **A ring floor by depth**, replacing "strictly further out than your parent",
   with the parent-relative rule kept as a ranked cost. See MAP-LAWS Law 3.
3. **`gapFor` and `leastApart` wired up** — the spacer widened by rung, and the
   same `leastApart` used for the gap between two cells, for the step between
   two rungs, and for the room a crowd needs. Law 4 is now one function with
   three callers rather than three numbers.

### The four things the first attempt learnt, and what each cost here

- **A place must never be seated where its own people cannot stand.** Room is
  asked as a **flood fill** over ground that is both empty and legal for a
  member of the crowd, bounded by the crowd's size. Counting free cells in a
  disc instead — the obvious version — reads healthy on ground split by a
  stranger's territory, and left teams in one piece at 196 of 395.
- **Asking the spacer is the entire cost.** `ringArc` in `coords.ts` enters a
  ring by bisection instead of sweeping it, which is exact rather than
  approximate: a ring is convex about its centre, so the cells inside an arc are
  one contiguous run of indices. It is held to the brute-force filter over
  **11,520 arcs** in `hex.test.ts`, because the first attempt's narrowing
  silently changed which cells were eligible and put 1,249 breaches back.
- **People stay seated relative to their team.** Two seaters, deliberately: the
  doorstep one did not change at all.
- **Both drivers still work.** The atlas is untouched; `sideways`, `kin` and
  `thicken` all still do what they did.

### The mistake that cost the afternoon, and is worth not repeating

With the arcs absolute, a unit's cell no longer depends on where its parent
landed, so the walk was rewritten **rung by rung** — which is true, and not the
point. It seats every node of a rung cheek by jowl and *then* sends each one's
crowd looking for ground that has already gone: 53% of people ended up off their
own parent's doorstep, teams in one piece fell to 202 of 395, **and every single
node was legally placed with the spacer count still reading nought.** Laying each
branch whole, crowd first, took it to 391 with nothing else changed. Order is a
placement rule like any other.

### Room by rung — the sweep behind `RUNGS_PER_HEX = 2`

Greg left the number open. Every setting holds the spacer at nought except 4,
where the ground runs out on the largest company; the table is in MAP-LAWS Law 4
and the sweep is `rungs` on `RadialOptions`, so he can be shown any of them.

### Not verified

**Not looked at in a browser.** The figures above are from the engines, which are
pure, and they are all `scripts/hexZoning.ts` reports; nobody has yet opened
`/lab/hex` on the three demo companies and looked at this. That is the next
thing, and it is the thing that decides whether the longer connection lines read
as a fault.

---

## The hand and the centre (2026-10-17, later)

Greg, having seen the absolute arcs land: *"master-centre should be the only node
that drives the radial distance behaviour. Once a node is picked up and moved, it
should not become its own master-centre in the same way. But there should be a
relationship of sorts."*

### What was in the way

Three mechanisms decided where a dragged branch's children went, and one of them
was already dead:

1. **`relayBranch` laid the branch as a company of its own** — anchor at the
   origin, its own arcs, its own ring floors, then translated under the hand.
   Measured: picking up Everest Region re-laid its three business units
   overlapping each other by **152°**, where the same branch laid in the map's
   own frame overlaps by **nought**. That is the model Greg retired.
2. **`placeIsland`'s `radiateFrom` path** re-flowed a branch outward from its
   parent — and had been unreachable since the armed gesture started returning
   early on its own shape. A whole third placer, deleted.
3. **Tidy's phase two** turned each branch to face away from *where its chain
   arrives*, by rigid rotation. See below.

And one thing that made the fix possible at all: **the engine never saw the
hand.** Hand placements are pasted over the layout afterwards, which is why the
re-lay had to be a separate function with a model of its own.

### The rule

One number, from figures the engine already had:

```
deference δ = floors[depth of the node] / distance(hand, master centre)   capped at 1
t(k)        = δ · min(1, k / taper)      k = rungs below the node in the hand
```

`floors` is Law 3's schedule, so there is no new constant and nothing to tune,
and it scales from Sparrow Jam to Northwind untouched. `t(0) = 0` is Law 0. The
two ends of the blend are both the engine's own: **the master centre's picture**
is the calculated layout, and **the orderly chart** is `chart.ts`.

**It settles at δ rather than climbing to 1, and that was a bug first.** The
first version read `min(1, k · δ)`, so deference accumulated with depth and
anything eight rungs down was fully back under the master centre however far the
branch had been dragged — a test asking whether a far-dragged branch had become
a chart found **2.5%** of it on the far side of the hand. Greg's three cases vary
with distance, not with depth.

### The chart is square, which a honeycomb is not supposed to allow

Lattice directions are 60° apart, so the chart was going to be sheared. It need
not be: on flat-top hexes `(+2, −1)` moves **purely sideways** in world space and
`(0, +1)` **purely up and down**, so the two are at right angles and the chart is
a proper right-angled chart. `rotateCell` turns it onto real cells with no
rounding, so it always grows away from the master centre.

**It charts places, not people.** A tidy tree's width grows with its leaves, so
charting Northwind's biggest branch person by person would be some 2,000 cells
across — twenty times the width of the whole company. People stay the crowd
around their own node, which is Law 3's clause anyway. Even so **the chart of a
1,258-unit branch is 863 cells wide against a map of radius 109**, and that is
the honest objection to dragging a division to the edge. It is on the panel.

### Measured, on every company, at seven settings

`npm run hex:zoning` prints it. Northwind, picking up Everest Region (1,258
units, rung 3, its floor 22, sitting 22 out on load; the clean load is 0 spacer
breaches, 395/395 teams, 85% touching their family):

| dropped | deference | teams in one piece | spacer | two on a cell | re-lay |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 11 out | 1.00 | 394/395 | 0 | 0 | 10ms |
| 22 out | 1.00 | **395/395** | 0 | 0 | 8ms |
| 33 out | 0.67 | 368/395 | 0 | 0 | 9ms |
| 44 out | 0.50 | 382/395 | 0 | 0 | 7ms |
| 66 out | 0.33 | 393/395 | 0 | 0 | 5ms |
| 176 out | 0.13 | 394/395 | 0 | 0 | 4ms |
| 440 out | 0.05 | 394/395 | 0 | 0 | 4ms |

**Both ends are clean and the middle is where it costs something** — up to 27 of
395 teams at δ ≈ 0.67, where every body is aimed between its chart place and its
home one and bodies from opposite ends of the branch meet in the same ground.
Aiming tidy at the branch puts them back. The same shape holds on the 1,000-person
company (48/48 at both ends, 41/48 at the worst), on Digital Tailoring and on
Sparrow Jam.

**Law 0 above Law 4, visibly.** The node keeps the hand's cell even when that
breaches a stranger's spacer — two or three breaches in the Aurora Team cases
above — because where a hand puts something is not the engine's business to
improve. The one thing that overrides the hand is Law 1: if somebody who is not
moving is standing there, the node takes the nearest free cell and the caller is
told (`held: false`).

**Speed.** 10ms for the largest branch on the largest company, so the shape is
re-laid as the hand moves rather than frozen when the gesture arms — which it has
to be, because the whole point is that the answer depends on where you put it.
Getting there took one wrong guess worth recording: the first version took 56ms,
I assumed the string cell keys and changed them, and it measured 59ms. The cost
was `spiral` building all 1,801 cells for each of 1,258 placements; walking ring
by ring with an early return took it to 6.7ms. The integer key is worth a further
1.1ms and stays, but it was not the fault.

### Tidy's turn is retired where the master centre decides which way is out

Phase two rotated each branch to face away from its own parent. With absolute
arcs and deference both answering that question from the centre, it is a second
opinion and the weaker one. Measured on Northwind, one tidy on a clean load:

| | turning | not turning |
| --- | ---: | ---: |
| tidy takes | 6,855ms | **1,177ms** |
| spacer breaches | 4 | **0** |
| teams in one piece | 389/395 | **392/395** |
| chain crossings | 149 → **124** | 149 → 138 |

It buys 14 crossings of 149 and costs four breaches of Law 4, three bodies under
Law 2 and **5.8× the time**. Law 5 is ranked last for this kind of trade. The
atlas keeps it, unchanged — it has no floors and nothing to defer to.

### What was not done, and why

**The descendants are still stored as placements.** The plan was to commit only
the anchor and let the layout re-derive the rest, which is what Law 0's tier
table implies. It turns out not to matter: `deferBranch` is always handed the
**calculated** layout rather than the arrangement pasted over it, so a second
pick-up derives the answer afresh whatever is in the store. Routing on-load
rendering through the driver — giving the engine the hand as an input — is a real
improvement and a separate change.

---

## The far end was linear, and is a circle again (2026-10-18)

Greg, having looked at a large branch dropped far out: *"it's clean and legible…
that's not the criticism. The struggle is that math and reality collide to
produce elongated less legible results. I think we need to preserve the spacing
around master-centre, but reinstate the way the leaf clustering happened the
further away it gets… a tendency toward a circular arrangement rather than a
linear one."*

And then, which is the better question: *"I've just talked myself into basically
saying 'undo' haven't I? Because what I've just asked for is each node becoming
its own master centre the further away from true master it becomes?"*

**No, and the distinction is the whole design.** The behaviour retired on 17
October laid a picked-up branch about its own node **whatever the distance** —
nudge it two cells and it still re-centred — and it did so through the
*relative-arc* driver, which fanned a branch's children right round it: Everest
Region's three business units overlapped one another by **152°**. Both faults
are gone independently: the arcs are absolute since 17 October, and the distance
condition is the dial. So the far end can be the branch laid about its own node
again, and it comes out as clean wedges — **0° overlap**, spans of 74°, 63° and
46°.

### Why the chart had to go, in one number

A tidy tree's width grows with its **leaves**; a map grows with the square root
of its **units**. So they scale apart, and the crossover is sharp:

| branch | units | across, on the map | as a chart |
| --- | ---: | ---: | ---: |
| Granite Division | 2,811 | 217 | 1,933 × 11 |
| Orchid Business Unit | 707 | 157 | 483 × 9 |
| Iris Chapter | 266 | 115 | 177 × 8 |
| **Ridge Domain** | **113** | **93** | **75 × 5** |
| Beacon Cluster | 24 | 25 | 9 × 2 |

Below about 150 units a chart is *narrower* than the branch already was — it
genuinely tidies, which is what was asked for. Above it the chart runs away, and
at a division it is a ribbon nine times too wide, which is what Greg saw.

### What the swap costs, measured

Northwind, dropping a branch far from the centre. **The chart wins on line
crossings and loses on everything else**, and that is worth saying plainly
because reduced crossings were part of what Greg asked to get back:

| branch dropped far out | | crossings on the map | reaches, from its node |
| --- | --- | ---: | ---: |
| Everest Region, 1,258 units | chart | **122** | 513 rings |
| | its own shape | 268 | **85** |
| Orchid Business Unit, 707 | chart | **150** | 246 |
| | its own shape | 175 | **68** |
| Iris Chapter, 266 | chart | 145 | 119 |
| | its own shape | **135** | **61** |

A clean load of the same company is 149 crossings. So a chart of a big branch
actually crosses *less* than the map does at rest — it is planar by construction
— at three to six times the footprint; a body laid about its own node is compact
and packs its lines together. Law 5 ranks lines last, and compactness is what
Greg is optimising, so the body wins; but the trade is real and it is not what
either of us expected.

The laws hold across the dial, on every company: **nought two-on-a-cell, nought
spacer breaches** (other than the hand's own node, Law 0 above Law 4), **381–395
of 395 teams in one piece** against 395 on a clean load, and the dip in the
middle of the dial is gone — 385 at δ 0.67 where the chart gave 368.

### A residual worth knowing about

The pull toward home is `δ × (distance home)`, and `δ` is the rung's floor over
that distance — so **the pull converges to the floor**, about 22 cells for a
rung-3 branch, however far out the hand goes. Each body is pulled toward its own
home cell rather than all in one direction, so the half-turn fan is sheared into
something rounder: 14% of the branch sits more than 90° round from straight-out,
the worst at 126°. Greg asked for a tendency toward circular, so this reads as
the dial working rather than as a leak — but it is why the far end never becomes
*purely* the branch's own shape, and if it ever wants to, deference has to fall
off faster than `1/d` (`1/d²` would do it, at the cost of a weaker middle).

### What it cost in code

`chart.ts` and its eleven tests are deleted; `branchShape` in `defer.ts` is six
lines over `relayBranch`, which has done exactly this since 16 October. The dial,
the floors, the spring-back, the crowd travelling as one body, the retirement of
tidy's turn and of the dead radiate path all stand unchanged. The gesture is back
to **working the shape out once when it arms** — a branch's shape does not depend
on where you drop it, only on which way it is turned, and turning a lattice shape
by sixths is exact.

---

## Room round a group of teams, and grey for the room (2026-10-18, later)

Greg, having left the placement rules alone — *"they kinda work"* — asked for two
things about **space** instead:

> *"A collection of teams with a common parent together gain an additional
> outline of one hexagon's worth of space around the drawn area that they
> occupy, even if they're 'archipelago' — in the case of an archipelago, the
> exclave and the main mass would both receive the two-level hexagon spacing."*
>
> *"The hexagon spacing itself should be a faint grey — just darker than the
> background, regardless of what colour a team has. The secondary outline (for
> groups of teams) should be a grey between the background and the team
> outline."*

### Three levels of belonging, still one rule

Same team may touch; same group keeps one clear hexagon; different groups keep
two. It is a property of a **pair**, which is why the archipelago clause needed
no code — a scattered group keeps its ring round every piece without anybody
having to find the pieces — and why it belongs in `spacerRule` beside
`mayTouch` rather than anywhere a placer could hold a second opinion. That
function now hands out `apart(a, b)`, the whole of Law 4 in one place, and the
two placers stopped threading four arguments through every call.

Nothing above team level changed. Those rungs already have their room.

### What it cost, measured

| Northwind, people | before | after |
| --- | ---: | ---: |
| radius | 109 | **117** |
| teams in one piece | 395/395 | **389/395** |
| spacer breaches, every company | 0 | **0** |
| touching their family | 84.7% | 84.5% |
| typical step home | 2 | **3** |
| layout | 55ms | **89ms** |

The step home rising by a cell *is* the feature: things that are not in the same
group now sit a hexagon further apart. The six teams are the price of the same
thing — the rungs where teams live are the crowded ones, and Northwind's depth 8
holds 80 teams and some 900 people in one band.

### Two faults the extra ring found, both worth keeping

**The rung schedule was a cell short.** It stepped from one rung to the next by
`apart(repA, repB)` — the two *representative* units — and the group term only
fires between two team-level things, which the representatives usually are not.
So the rungs holding teams came out tighter than their teams needed. It now
steps by the widest ring either rung keeps, plus a cell, which over-provides by
one where a rung of teams faces a rung of divisions. That is the right way to be
wrong.

**A unit with a full slice had nowhere legal to go, and took somewhere illegal.**
`ringArc` offers cells outside the arc only when the arc holds *none*, so a unit
whose narrow slice was full never saw the legal ground beside it. The ranking
has always said a stray costs 1 and a spacer breach costs 2 — the search simply
could not act on it. One team on Northwind, **Union Team 235**, walked 21 rings
out from its floor and then breached, which showed up as 2 breaches and 7 units
standing closer than the rule allows. The slice is now widened in two steps
before any breach is accepted, and the figure is back to nought everywhere; the
one unit that needed it is counted in `strayed`.

### Colour is for what is there; grey is for the room around it

The spacing was taking the hue of whichever region's wash it fell inside, so the
space a team keeps read as more of the team. Every spacer ring is now the same
neutral whoever it belongs to — which also makes it visible at a glance that the
spacing rule is one rule.

The group's ring is drawn as a line, in a grey between the background and the
team outline. **That is a border coming back**, eight days after Greg took them
off every bubble — *"there are borders around the bubbles, they don't need to be
there"* — and the difference is worth stating: what was drawn then was a
coastline in each region's own hue at every rung, twelve deep on the largest
company. This is one line, at one rung, in grey, and it is drawn where there is
now real ground to show.

---

## Nearness stops meaning anything, and merging finally works (2026-10-19)

Greg, reviewing what was built before hex and deciding what to carry across:

> *"The existing hex interaction gets it right, and the earlier radial version
> had it — reparenting should ask for confirmation, even after it's showing an
> animation or visual to demonstrate to the user that it's happening."*
>
> *"Adjacency shouldn't have much meaning other than visually, even in hex. If I
> put something near to another thing, it means whatever the user wants that to
> mean — only if they manually reparent it does the nearness also become
> meaningful."*
>
> *"What we do want to pull in from the orbits model is the merge/reparent
> behaviour. This might end up with a rule-breaking 'two node leads' situation —
> and this is fine for now: just chain them along the same connection line axis,
> with the more recent the furthest away."*

Four changes, and the first is a deletion.

### A drop on free ground is a move, whoever it lands beside

`dropOutcome` used to return `offer-reparent` when a tile came to rest against
somebody else's family, and a dialog then asked whether to join them. That is
the map inferring intent from where two things happen to sit, which is exactly
what Greg took the meaning out of. The outcome, its dialog and the test that
pinned it are gone; `dropOutcome` now has two things to say about a release —
somebody is in the way, or the hand was held over a node long enough to mean it.

Adjacency still earns its meaning in `neaten`, which is a gesture somebody
asked for. It is only the drag path that stopped reading it.

### Node on node is the only gesture that means anything

The dwell was already there — 550ms, the orbital map's own, *a pass must not arm
anything*. What it was missing is everything the grow study learnt about making
the question visible before the hand lets go:

- **The neck.** Two nodes run visibly into one another while the dwell arms, and
  the shape stays while you decide, because the question on screen is about
  those two. It **pinches in the middle** — ends flaring into each node, the
  isthmus between them narrower than either — which is the whole of why a
  metaball reads as two things merging rather than as a bar joining them. The
  first version bulged in the middle and read as a pipe.
- **Two actions, the same two `/org` offers**: *reparent branch* and *merge
  entire branch*. `app/lab/hex/questions.ts` holds which are available and
  nothing else, because getting that wrong shut a door — see below.
- **The confirmation stays**, which is the part of the plan Greg sent back. The
  neck shows what the gesture is about; the dialog is still what commits it.

### The merge, which had been disabled on both maps for months

The button carried one stated reason for being dead: *what happens to both
units' people and who leads the result is undecided*. Both halves are now
answered — the people are children, so they are the survivor's children; and two
leads is allowed, chained along one axis (Law 3).

So `applyOverrides` gained `unitMerge`, beside the reparent and seat overrides it
already held. Merges run **first**, because every later override talks about a
tree that no longer holds the units that went in, and a merge into a unit that
has itself been merged away follows the chain to whoever is still standing. A
unit cannot be merged into its own descendant, and the company cannot be merged
away.

The lab keeps **two trees** as a result. A reparented tile *"stays exactly where
it was put and changes colour"*, so the layout is never re-run for one — which
is why `baseAllocation` has always been built from `baseTree`. A merge cannot
work that way: a node has gone and its people belong to somebody else, so the
ground has to be laid again around the survivor. `mergedTree` is what the layout
sees; `tree` adds the hand's reparents on top of it.

The dialog went through three shapes in a day, and the one that stuck is the one
`/org` already had.

It first asked the grow study's two questions — *make them one team*, *give them
a shared parent* — plus *reparent branch*. Greg cut the middle one within the
hour: *"There's also an uncalled-for option which reparents the thing that isn't
moving, and snaps back to the layout unchanged… There should not be an option
that does whatever XOR thing is happening to the team not being moved."* Two
objections in one, and both are right. **A shared parent moves the unit the hand
is not holding** — you pick up A, and B changes too. And because a reparent
moves nothing on the map, the only visible result was a map that looked exactly
as it had, which reads as the button having done nothing.

> *"We need the options to match exactly what we had on the radial /org version.
> A node gets dragged, the user hovers, an animation plays, an option is given.
> The options are reparent the branch or merge the whole thing."*

So the dialog is now `/org`'s, down to the eyebrow that says nothing has
happened yet: **RELATIONSHIP CHANGE · NOTHING HAS CHANGED**, the title *Move or
merge "A" with "B"?*, a line of fact about what the hand is carrying (*"Granite
Division has 2 units below it. It holds 20 people."*), a sentence for each
action, and three buttons.

**The difference from `/org` is that merging is switched on.** That map's
*Merge entire branch* has always been disabled, with the explanation printed in
the dialog: *what happens to both units' own people, and who leads the merged
unit, still need deciding*. Greg decided both on 2026-10-19, so here the button
works. It is disabled in one case only — when either side is a **person** —
because folding a person into something else means everything they hold moves
across and then they stop existing, and that is deleting somebody rather than
restructuring. The dialog says so in the same note box `/org` used.

### The door this shut, within an hour of Greg opening the page

The dwell was built with the grow study's rule — *"like pairs with like"*, two
teams or two people — and that rule does not survive the journey. In grow a
person meeting a *team* was answered somewhere else: you dropped them on the
team's orbit. Hex has no orbit, and the adjacency route was deleted the same
afternoon, on purpose. Gating the dwell as well left **no gesture at all** for
making a person report to a team.

Greg found it on his second try: *"I was able to reparent Dune Team 5 into a
child of Buff Team 6 (good), but thereafter unable to reparent or merge."* Two
teams are alike, so the first worked; the pair he reached for next was not, and
the map silently did nothing.

**Neither half was wrong on its own, and together they were.** That is the thing
worth keeping: a deletion and a narrowing, landed in one change, each defensible
and jointly a dead end. The dwell now arms for any two units that are not
already one inside the other. `holdActions` is a short pure function with its
own test, and the test that matters is not that each pair gets the *right*
offer; it is that **every pair can be reparented** — so no combination of two
units is a gesture that quietly does nothing.

### "Only fires once" — two more doors, and how the first search missed them

Greg, after the above was fixed: *"reparenting or making a change only fires
once. That means once I've moved something I can't manually move it again. I
want to be able to change parenting indefinitely."*

The first search for this **failed, and the way it failed is the lesson**. The
gesture was driven from a script that reparented the same unit three times in a
row and concluded the fault did not reproduce. It did not reproduce because the
script paused between gestures and used coordinates captured before anything
moved — it was not doing what a hand does. Driving it back to back, from
positions found fresh each time, reproduced it immediately. **A reproduction
that skips the rhythm of the real gesture is not a reproduction.**

Two causes, both of which shut the gesture for the same five seconds.

**The armed re-pickup never read the dwell.** Picking the same node straight
back up within five seconds arms the "tree it" gesture, and that path set
`heldOver: null` outright — so for five seconds after *every* move, no
relationship question could be asked at all. Picking a node straight back up is
exactly what you do when a move has not come out how you wanted, so this is the
common case rather than an edge. It had survived since 2026-10-02 because
adjacency was a second route to a reparent; deleting that the same afternoon
left this as the only route, and the gap became the whole gesture. Re-laying a
branch and asking about its parent are different questions, and the hand resting
on another node answers the second whatever the first is doing.

**The refusal was asked before the question.** A branch has to find room for
every one of its cells, and `onPointerUp` checked that *first*: no room, and the
release said *"your tile can't fit here right now"* and threw the hold away. On
a map a hand has rearranged — Greg's had 104 placements on it — the ground
beside a target runs out, which is why it worsens as a session goes on. **Neither
answer needs the branch to go anywhere**: reparenting re-lays it under its new
parent and merging dissolves it. So a deliberate hold is now answered before
anything is refused, and the landing is carried through for the reparent, which
keeps the branch where the hand left it when there was room.

**And the reparent now commits where it landed.** It used to set the new parent
and let the branch snap back to its calculated cell, which is the same objection
Greg raised about the shared-parent option: *"snaps back to the layout
unchanged."* A gesture that visibly does nothing reads as a gesture that failed.

### Two faults the browser found, both worth keeping

**A person's team does not follow a merge on its own.** The company comes down
from the server as it was built, so after a merge a person still pointed at a
team that no longer existed. The first thing the panel then said was that two
people who had just been put on one team were strangers to each other — *6 of
22 people sit next to somebody from another team*, on a map where the right
answer was nought. The person→team map is now resolved through the merge chain
before anything reads it, and the figure is back to nought.

**A stale hand placement can resurrect a unit.** The placement overlay stamps
saved cells on top of the layout and only checked that the target cell was free.
A unit merged away still had its placement saved, so it went back on the map as
a cell with nothing behind it. The overlay now takes the layout as the authority
on who exists.

### Measured

| | before | after |
| --- | ---: | ---: |
| tests across the suite | 1,671 | **1,716** (45 new) |
| dialogs a drop can raise | 4 | **3** |
| `dropOutcome` outcomes | 4 | **3** |
| actions on the hold dialog | 3, one dead | **2, both live** |
| seconds after a move with no relationship gesture | 5 | **0** |
| pairs of units with no reparent route | 0 | **0** (briefly: every mixed pair) |

### What was deliberately not built

Boundaries deciding a parent, and severing. The plan sent to Greg had the
innermost bubble you are inside choose your new parent, and a node dropped
outside every bubble severing itself. He declined both: *"you'll note regions
around teams — these aren't meaningful YET — only the nodes themselves (rather
than the spacing around them) create interactions such as merge or reparent."*
On the company's own bubble: *"yes, technically everything is in the company
bubble. If something is 'outside' of that bubble, that's meaningful, but I don't
know what meaning yet. We'll cross that bridge when we come to it."*

---

## Grow, on the lattice — phase one (2026-10-19, evening)

Greg, after merge and reparent landed: *"lab/grow was brilliant — you created an
intelligible, clear way of us building teams. We need to do that within the hex
layout paradigm. That is our next task."*

The original study was recovered from `archive/codex/grow-child-orbits` rather
than rebuilt from its write-up — 3,320 lines of `app/lab/grow/GrowLab.tsx`, with
the sequence, the wizard and the reveal intact.

### What the lattice gives for free

Grow's hardest problem was **angles**. A node arrived at the angle you clicked,
and that angle had to be remembered — `rememberChildAngle`, `angleHints` — or
the siblings would spin round their parent every time a new one appeared.

A lattice has no angles. **The cell you point at is the position.** That whole
class of problem is gone, and with it the one thing that made the orbital study
feel slightly unpredictable as a team filled up.

### Unconstrained by the engine, without suspending a law

Greg's scoping call, and the thing that shaped the build:

> *"When we're on the Grow path, I think we need to pay a lot less attention to
> the layout engines that dictate the radial shape. People are going to want to
> create things wherever they want, then tidy them up using assists later…
> I'm not confident we want to invoke the auto-tidy for a large corporation yet.
> I fear it'll be too opinionated too quickly."*

It needs **no law suspended**, and that is worth stating because the first plan
proposed suspending one. Every law in [MAP-LAWS.md](MAP-LAWS.md) is written as a
constraint on the **engine** — *"the engine may not place a team…"* — and Law 0
says the hand outranks the engine. So the mechanism is one line of intent:
**everything born here is born as a hand placement.** Its cell goes into `moves`
and its id into `pinned`, and no driver has standing to move it.

What that leaves running during Grow: Law 1 (one cell, one unit) always; Law 2
(a body stays whole); Law 4 (the spacer) only where the *engine* places
something, which here is just the pieces it makes for you; Law 5 (lines follow).
Law 3 — children sit outward from the master centre — simply never fires,
because nothing is being placed by the engine for it to constrain. Auto-tidy
already only ever ran from its own button; `neaten` is called in exactly one
place.

**One good consequence.** Inserting a parent only threatened to shove a whole
branch outward because the ring floors demanded it. With nothing enforcing
rung-distance during Grow, a new parent takes a free cell beside its child and
the chain redraws — no relayout under the hand, which was the riskiest thing in
the plan.

### What phase one is

`/lab/hex?company=blank` — a fifth company that the fixture leaves empty, so
creation is tested against the same engine, the same drivers and the same drag,
merge and tidy gestures as everything else. One map, not two.

- **Blank paper and one thing to press.** *"The user starts with almost
  nothing."* Click it and you make a **human** — not a company, not a value
  stream. With nothing made yet the canvas draws nothing at all: the engine
  synthesises a root so the rest of it always has one, and drawing that put a
  single enormous cell behind the button.
- **Name → role → "does this person have any teammates?"** Only the lone first
  person is ever asked the last one; asking anybody else would mean the team
  already existed, and the reveal would be dead.
- **The reveal.** On *yes*, two nodes arrive at once — the team takes the cell
  the person was standing on, and the two humans step to either side of it.
  **The team is discovered, not declared.**
- **A node breathes until it is described, not until it is named.** "Named but
  no role" is still an empty node. A breathing node answers a tap by opening its
  own wizard rather than being picked up.
- **The camera frames the ground, not just the nodes** — a few cells of air on
  every side, and clear of the settings panel. Fitting a one-node company to its
  own bounds puts a single cell across the whole glass, which reads as a huge
  coloured shape rather than as a person standing somewhere.

**`prefers-reduced-motion` is respected**, which closes the task opened against
the merge neck this morning. Both motions — the neck arming, and a node
breathing — stand down, and the rAF clock is not started at all.

### The fault that cost the most, and the shape of it

**An effect that loads state must not depend on anything derived from that
state.** The arrangement loader filtered saved placements against `baseTree`,
and `baseTree` is now built from the company *plus* whatever has been born — so
loading set `born`, which rebuilt the tree, which ran the loader again. React
says it plainly: *maximum update depth exceeded*, several hundred times a
second, with the page still looking almost normal.

The first fix — ask the fixture's own ids instead — was wrong in a quieter way:
it narrows what counts as a known id, and the tree legitimately contains ids the
fixture does not, such as the root the engine synthesises for a company with
several. The tree is now read through a ref, which asks the same question of the
same tree without tying the effect to it.

### Verified

Driven end to end on `:3001` against the blank company: blank paper, the seed,
the name step with its suggestions, the role step, *"Does Ana have any
teammates?"* by first name, and the reveal putting Ana at (-1,0), her team at
(0,0) and the new teammate at (1,0) — one row, the team between them, 100% of
children touching their family and nobody next to a stranger. Tapping the
unnamed team opens *"What is this team called?"*. Console clean on a fresh tab;
the four fixture companies are unaffected, and Digital Tailoring still loads
Greg's own arrangement.

**Not built yet** — phases two and three: growing from the spacer ring (a
person, another team, something above it, a separate team), and the callout
placement that scores sides against the other nodes rather than picking one.

---

## Verified, and not

**Verified by tests** (71 new; 188 across the hex engine and the engine boundaries, all passing): ring and
spiral geometry; cell↔world round-tripping over 841 cells; neighbours exactly
two inradii apart; Law 1 by re-running and by reversing the input order; Law 4
on four company sizes, both densities — every unit in its own cell, no disc
touching another, every person inside their own unit's hexagon; that a chain
grows by its length rather than exponentially; that a parent never seats more
than five children adjacent; and that the packing beats the orbital layout by
more than three times on each axis; and, since 2026-10-02, that a cousin's
branch does not eat the ground a parent's own children need, and that chain
passages under a stranger stay under 45 on the 1,000-person company; and, for
the people, that nobody sits inside their own node, nobody crosses into the next
cell, and no two dots overlap at 4, 12, 28, 50, 108 or 130 to a team — the cell
containment computed in the test from the six edge normals rather than borrowed
from the layout, because the old test used the inscribed *circle* and would have
passed a rule that was wrong at the corners.

**Verified in a browser** at `/lab/hex`, on all four companies, both densities,
both layouts: whole-company view, the zoom ladder down to individual people,
pan, wheel zoom, fit, hover, and the region colouring. Console clean after the
hydration warning was fixed.

The doorstep price was checked in the browser on 2026-10-02 on all four
companies, with saved arrangements cleared first — an earlier look at the
1,000-person company was reading 154 saved moves on top of the allocation and
showed nothing about it.

The people were checked the same day at 1440×900 — a 13" laptop — on Digital
Tailoring and Northwind, both densities: the fifty-person team as three
hexagonal rings with the lead on the chain, a small team as a single arc on the
far side, about three teams across the screen when people are fully shown, the
rings visibly lining up on the same spokes, and 62fps on Northwind. **That frame rate is an idle `requestAnimationFrame` count, not a
figure under load**, and the browser pane throttles when hidden, so treat it as
"nothing is obviously wrong" rather than as a measurement.

The atlas was checked in the browser on 2026-10-03 on Digital Tailoring and
Northwind, both shapes, at whole-company view: territories read as coherent
coloured places with their divisions named, against the archipelago's scatter.
**Not checked:** the atlas at close zoom, with people showing; dragging a branch
under it; and the orbits mode beside it. The numbers in the table above are from
the test suite, not from the browser.

**Verified in a browser on 2026-10-19**, on Sparrow Jam and Digital Tailoring
with people as the smallest unit: a drop against another family is a plain move
and raises no dialog; the dwell draws the neck and it pinches; two people get
*"Do these two work together?"* and the reparent lands; a person held over a
team offers the reparent with merging greyed out and its reason shown, and the
reparent lands; the same person was reparented three times running to three
different parents; and a merge from the dialog takes the company from 27 units
to 26 and survives a reload. **Four gestures back to back with no pauses** —
three reparents of one person onto three different parents, then a merge — each
one raising its dialog and changing what it said it would. Checked on `:3001`,
the server Greg is actually looking at, on Sparrow Jam, on Digital Tailoring
against his own saved arrangement without disturbing it (104 moves and 1
reparent, unchanged after), and on the 1,000-person company; two teams get all three
choices, with the shared parent named and correctly disabled when they already
have one; a merge removes the unit, re-lays the ground around the survivor, and
survives a reload; and the survivor's two leads chain one behind the other along
a single axis. Console clean. **Not checked in the browser:** the atlas driver
beside this, Northwind, and whether the merged crowd keeps the spacer at scale —
after one merge the panel reports **6 cells pressing against a different
top-level group** where a clean load reports nought (see TASKS.md).

**Not verified:** touch and pinch (the page handles pointer events, but no
real device was used); `prefers-reduced-motion` — **there is now one motion in
the study**, the neck arming over the dwell, and it does not yet respect the
setting (see TASKS.md); anything on a five-year-old iPad; and frame rate under
load — the
browser pane throttles `requestAnimationFrame` when hidden, so the numbers I
could take were meaningless and none are quoted.
