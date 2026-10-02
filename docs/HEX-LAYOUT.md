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

## Verified, and not

**Verified by tests** (53 new, 712 across the suite, all passing): ring and
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

**Not verified:** touch and pinch (the page handles pointer events, but no
real device was used); `prefers-reduced-motion` (there is no motion in the
study); anything on a five-year-old iPad; and frame rate under load — the
browser pane throttles `requestAnimationFrame` when hidden, so the numbers I
could take were meaningless and none are quoted.
