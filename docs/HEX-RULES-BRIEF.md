# The hex map: where the rules contradict each other

**A hand-off brief, written 2026-10-06.** It exists to be taken into a fresh
conversation and turned into a single, non-overlapping set of rules.

All the work described here is on the `lab` branch. `next`, `release` and `main`
are untouched.

---

## 1. What the map is, in one page

A company laid on a uniform flat-top hexagonal lattice. Every unit gets one
cell. Importance is carried by zoom and treatment, never by size. Colour is
territory. Connection lines ("chains") run along the six centre-to-side-midpoint
axes only.

Two things changed recently and between them they are the cause of most of what
follows.

**People became units.** A person used to be a dot orbiting its team's node
inside that team's single cell. Now, with `?strata=people`, every person is a
unit in their own right and owns a cell. Greg, 2026-10-02: *"I want to avoid
dual modes — one mode to view people, one to view the org. I don't like it, it's
inelegant."*

**The archipelago became an atlas.** Units used to be placed on an open plane
and kept apart by a spacing rule. Now every unit's ground is **nested inside its
parent's**, so a division is a place you can point at rather than a hue shared
by scattered teams. Both arrangements are still live behind a **shape** toggle
at `/lab/hex`, so they can be compared rather than argued about.

### The files

| file | owns | written for |
| --- | --- | --- |
| `coords.ts` | the lattice: cells, rings, world positions | — |
| `territory.ts` | **the atlas**: nested territories, measure-up/place-down | the new model |
| `allocate.ts` | **the archipelago**: open-plane placement with kinship spacing | the old model |
| `arrange.ts` | dragging, dropping, landing, clashes | the old model |
| `tidy.ts` | the tidy-up gesture (`neaten`) | the old model |
| `route.ts` | drawing chains, after placement | either |
| `people.ts` | seating people on rings inside one cell | the retired model |
| `scene.ts` | turning an allocation into something drawable | the old model |
| `HexLab.tsx` | the lab: wiring, camera, interaction, the panel | — |

---

## 2. The five systems, and who answers each question

This is the heart of the problem. **Both columns are live at the same time.**

| question | the atlas answers | the drop and tidy answer |
| --- | --- | --- |
| **placement** — where does a unit go | `territory.ts`, nested territories | `arrange.ts`, nearest free cell on an open plane |
| **grouping** — what travels as one body | a territory, at every rung | `groupOf` → a flat team id |
| **spacing** — how far apart | a share of the territory's own size | `GAP_BY_RUNGS` by kinship rung, capped at `TEAM_GAP = 3` |
| **togetherness** — what counts as "together" | within the allowed spacing | `isOnePatch` connectivity |
| **routing** — does it affect placement | never consulted | `neaten` moves things to reduce chain crossings |

`HexLab.tsx` hands `groupOf` and `gapBetween` — both from the old model — to
`placeIsland` **in both shapes**. So a map laid out by one rule is rearranged by
another every time a hand touches it.

---

## 3. The contradictions, worst first

### 3.1 Two spacing rules fight on every drop

The layout gives a rung-4 group **26 clear tiles**, because the gap is a share
of the group's own size. The drop path then enforces kinship spacing **capped at
3**. Every drag quietly compresses the map back toward the retired rule.

### 3.2 "Group" means two different things

`partedLanding` moves **teams** aside when a drop clashes. Above team level the
atlas's indivisible body is a **territory**. Moving teams out of a territory is
precisely how a territory comes apart — which is what confetti looks like.

### 3.3 Three definitions of "together", and they disagree

- **rule-relative** (`stats.connected`): is this unit further out than the
  spacing rule *told* it to be?
- **adjacency** (the live panel): is it touching a parent or sibling?
- **connectivity** (`isOnePatch`): is this set of cells one patch?

The first has now misled twice. On 2026-10-06 the panel reported *91% of
children touch their family* while Greg could see named people plainly adrift —
because the figure was computed on the **calculated** layout and copied
unchanged through the memo that applies hand placements. Counted live from the
screen it was **86%, with 400 units not touching**. Both numbers were correct;
they were about different maps.

The allowance is the other half of it: with a size-proportional gap, "allowed"
can run to a dozen tiles, so somebody plainly adrift still counted as connected.

### 3.4 Routing drives placement in one path and not the other

`territory.ts` never consults a route. `neaten` in `tidy.ts` calls `chainsOf`
and `countCrossings` in four places and uses them to decide what to move and
which way to turn it.

**These two objectives pull in opposite directions.** Shortening a chain pulls a
branch *toward* its parent; territory integrity pushes it *out*. On a small
branch there are few chains and the territory wins. On a big one the crossing
count outvotes it.

That is the best available explanation for Greg's observation that *"if I
manually pick apart nodes with 2–3 rungs of descendency and drag them into
distant space, the thing performs closer to how it should… what I can't figure
out is how it can't do this for slightly higher complexities."*

### 3.5 Two models of where a person lives, one of them retired but still load-bearing

`people.ts` seats people on hexagonal rings **inside** their unit's single cell.
People-as-units gives each person a cell of their own. `scene.ts` still calls
the first; it is inert when people are units, because there are no seats.

**But cell size is still derived from it.** `contentRadius` reserves room for
two rings of seats plus their work boards — contents a cell will never hold in
the new model. Every cell on the map is sized for the retired one. This inflates
the whole map by a large constant and is a plausible contributor to the
layout cost.

---

## 4. Legacy on hot paths

Everything below was written when **a unit was one cell on an open plane and a
group was a team**. All of it is still called on every interaction.

- `arrange.ts` — `nearestFreeCell`, `reflow`, `radiatingCell`, `partedLanding`
- `tidy.ts` — `neaten`
- `people.ts` — ring seating, via `scene.ts`
- `allocate.ts` — still the default allocator inside `scene.ts`
- `GAP_BY_RUNGS` and `TEAM_GAP` — the kinship spacing, fed into every drop

---

## 5. What Greg has been asking for

Gathered by theme rather than by date, because the rules want themes.

### Placement and precedence

- *"Child nodes do not have to directly snap to their parent nodes, they can
  snap to sibling nodes."*
- *"The highest-ranking node in the dragged group should position itself closest
  to its parent, regardless of how far that is… like a leaf on a branch."*
- The order of precedence on a move: **exist on the other side of parent to
  grandparent → spacing → tree away from parent.**
- *"Human nodes should occupy absolute space on the same level of the layout
  engine as the team nodes"* — and *"that human nodes occupy calculated space is
  the fix, so we need to give precedence to contiguous teams."*
- *"Teams are not their leaders"* — a team keeps a cell of its own.
- *"The layout should prioritise keeping teams contiguous, rather than reduction
  in parent-node connection back to master."*
- 2026-10-06, the proposed rule in full: *"for all teams whose membership is >1,
  preference them being placed into adjoining cells, with the connection line
  between them as short as possible, EXCEPT where that placement would conflict
  with an existing placement on-drop, in which case look for the nearest
  in-team-connecting unused tile, else place in space at the nearest unused tile
  with >n tiles between the node and non-nuclear relatives."*
- *"Database adjacency ≠ visual adjacency."*

### The atlas and family groupings

- *"We need to gently push for the whole thing to render with more visual
  organisation."*
- Asked to choose a lever, he picked two: **a readable grammar** and **nested
  territories**.
- *"A division's spine running along one of the six axes with its teams hanging
  off it."*
- *"Child nodes should radiate away from parent nodes on the opposite side of
  their grandparents, but not have an angle defining that radiation"* — because
  an angle-based rule accumulates: *"if my child sits at an angle to my source
  spine, then its child will similarly sit at an angle, and since we're using
  hexagons, we end up with spirals within four steps."*
- *"Tiles closer to the centre would be given negative preference for placement
  than those further away from it… it's increasingly difficult to automatically
  place a node close to a parent/grandparent/great-grandparent in that order."*
- *"The shape of the company needs to be somewhat organic."*
- *"Teams of humans should be forced together until a user separates them. So
  the point is we allow exclaves, but only when they are manually created."*

### Spacing

- First: *"sibling teams by default have one tile separating them. Cousin teams
  have two. Anything above a cousin has three."*
- Then: *"for every level of abstraction, add 1 additional tile-spacing rule
  between nodes."*
- Then: *"make the spacing rule 'curved' — make it follow a Fibonacci rather
  than a linear progression. That should visually cluster teams and their
  parents and push ever more space between the more distant relatives."*
- Then: *"remove the cap on how much spacing can exist at the top levels"*, and
  *"yes, I said nodes… but I also mean people/teams too, with the exception of
  team leads. So the space around master-centre should be HUUUGE. I want to see
  it in extremis."*
- On measurement: *"the grid is non-Euclidean, it's hexagonal, so measuring
  spacing on one axis — when there are three — will give room for error."*
  (Checked and now under test: on a honeycomb three hexagons meet at every
  vertex and all three pairs share an edge, so vertex-touching and edge-touching
  are the same relation. There is no diagonal. Ring-counting is sound.)

### Routing

- *"We should preserve how the connection lines emanate from the tiles… centre
  point to side midpoint."*
- *"In-team connection lines should preferentially chain via established routes,
  preferencing as few corners as possible, rather than attempt shortest-route.
  Think tree and branches rather than mesh."*
- *"Put a stronger opinion on connection lines being straighter the longer they
  need to be."*
- *"Put routers on a z-axis point below everything except the tile grid."*

### Clashes, dragging and tidying

The five rules of the rearrange engine, given 2026-10-03:

1. Moving a family node moves it **as-is**, including any archipelagos.
2. On a clash, **only the groups that clash** reposition, to the nearest space.
3. With no clash, shapes and relationships are preserved.
4. Picking the same node up again **within five seconds** tidies its branch.
5. The highest-parented node faces master-centre; children tree away from it.

And the fault still open, 2026-10-06: *"if I move a node — especially one with
multiple child trees — and even one of those end-nodes clashes with an existing
node, we get confetti across the whole family unit. Then when picking up and
dragging that same family to a faraway area, the confetti doesn't rectify, even
with auto-arrange."*

### Standing constraints

- *"It must run well on an entry-level iPad from five years ago, and on a Lenovo
  laptop IT hasn't upgraded in ten."*
- *"Demo mode uses invented data only."*
- Check every map change on both demo companies.

---

## 6. Measured facts the rules have to live with

Hard-won; worth not rediscovering.

- **The lever is almost never the router — it is where things sit.** Four
  separate problems that looked like line-drawing problems were placement
  problems. Sweeping turn costs from 12 to 500 moves "dead straight" from 73% to
  75% and costs 36 chains driven under strangers.
- **Territories cannot be discs.** Packing discs inside discs wastes about two
  fifths of the ground and nesting multiplies it: over eleven rungs it compounded
  to a root territory **1% full** and a map 5.7× wider. A territory must be the
  shape of its contents.
- **A gap must scale with what it separates.** Set by rung, the clear ground ran
  5 tiles at the top and 1 at the bottom while the groups ran from radius 119 to
  radius 1 — air worth 4% of a division's width and 100% of a person's. Every
  boundary looked the same, so none of them said anything. That is what reads as
  confetti. Changing it to a share of size took "people sitting next to somebody
  from another team" from **290 to 108**.
- **Facing must not accumulate.** Setting a unit's facing from birth order
  compounds every rung; six turns is a circle, so a branch meets itself inside
  four. 62% of units faced a different way from where they were placed. Reading
  the facing back off the placement took it to 45% — and the layout six times
  faster. The rest is not a facing problem: `placeChild` is dominated by its
  compactness term, which pulls every child toward the parent's existing mass
  whichever way it is turned. **Direction is not currently something the packer
  optimises at all.**
- **The simulation is not asking for exclaves.** No unit in either demo company
  has more than five children, so the lattice never runs out of room next to a
  parent. Every exclave is ours.
- **Cost.** The 2,562-person company in people mode takes about **6.4 seconds**
  to lay out. Uncapped rung-based spacing took 233 seconds. Lazy per-team
  interior layout is written and parked on the `hex-lazy-interiors` branch.

---

## 7. What the rules need to settle

One owner per question, and no second opinion.

1. **Precedence.** Three files currently decide placement and they do not share
   a cost function. Which one owns it, and what do the others become?
2. **Atlas and family groupings.** What is the indivisible body above team
   level — the team or the territory? Everything about clashes follows from the
   answer.
3. **Spacing.** One rule, applied identically on load, on drop and on tidy.
4. **Routing.** Is a chain ever allowed to move a node? (Recommended: no, and
   `neaten` stops consulting routes.)
5. **Clashes.** What is rigid and what yields? (Recommended: the branch in the
   hand is rigid; everything else yields or the drop is refused.)

Two of these are deletions rather than rewrites — stop `neaten` consulting
routes, and stop handing `gapBetween` to the drop path — and between them they
remove the two contradictions that account for most of the reported symptoms.

---

## 8. Where to read more

- `docs/HEX-LAYOUT.md` — the full write-up: every rule, every measurement, the
  dead ends, the engine seams, the open risks.
- `docs/TASKS.md` — three open items: branches facing the wrong way, the drag
  path still thinking in archipelagos, and the four-second layout.
- `lib/map/layout/hex/` — the engine, one concern per file.
- `app/lab/hex/` — the canvas renderer and the interactions.

Run it: `npm run dev`, then `/lab/hex`. Four companies, 10 / 45 / 1,000 / 2,562
people; a **shape** toggle for atlas against archipelago; a **smallest unit**
toggle for teams against people.
