# Where the map engine actually stands — a review

**Written for Greg and Nate first, 2026-10-15, before deciding whether to rewrite
the layout as concentric rings.** Everything here is measured, and every figure
names the company it came from. Nothing in this file is an opinion about what to
build next; it is an account of what is true now.

---

## In one page

**The engines are cleanly separated as *code*. They are not separated as
*decisions*.** Nothing in the map imports React, the dependency graph is shallow
and one-way, and the boundary test passes. But three different pieces of code
decide where a unit goes, and only one of them understands what a territory is.
That is the single fact underneath nearly every fault Greg has reported since
3 October.

**Of the six placement laws, one is fully enforced, three are partly enforced,
one is contradicted by the code that claims to obey it, and one is unbuilt.**

**The thing Greg is looking at in the 2026-10-14 screenshot is not one fault but
three**, and only one of them is about dragging.

---

## 1. The engines

### What is true

`lib/map/layout/hex/` is eight files, 4,765 lines. The import graph is shallow
and acyclic:

```
coords  ←  allocate  ←  territory
   ↑  ↑        ↑
   │  └── scene ── people
   ├── arrange
   ├── tidy
   └── route
```

- **Nothing** under `lib/map/` imports React, Konva, or the database. The whole
  engine is drivable from a script, which is why every figure in this document
  could be produced in seconds without opening a browser.
- The hex engine is reached from exactly four places: the lab page, two test
  files, and one script. It is not entangled with the product.
- `lib/__tests__/engineBoundaries.test.ts` passes.

**So the answer to "are the engines still discrete" is yes, as files.**

### What is not true

The engine boundary that matters for Greg's problems is not between directories.
It is between *questions*. [MAP-LAWS.md](MAP-LAWS.md) states the intended answer
itself:

> | question | owner |
> | --- | --- |
> | where does a unit go | the atlas (`territory.ts`) — **nothing else places anything** |

That is not the case. **Three separate bodies of code decide a unit's cell**, by
three different methods:

| who | how it decides | understands territories? |
| --- | --- | --- |
| `territory.ts` — the atlas | measures every child's whole subtree, reserves ground for it, then places | **yes** |
| `tidy.ts` — `neaten`, the tidy button | moves whole branches, measures the clear ground round the whole body | partly |
| `arrange.ts` — `reflow`, the five-second re-pickup | seats one node at a time, nearest acceptable cell, reserves nothing | **no** |

`arrange.ts` alone contains **twelve** separate calls that choose a cell.

This is not a tidiness complaint. It has a measurable consequence, below.

---

## 2. The laws, one by one

Measured on all three companies with people as the smallest unit.

| law | enforced? | the number | verdict |
| --- | --- | --- | --- |
| **0 — the hand outranks the engine** | partly | none exists | **the middle tier is unbuilt** |
| **1 — one cell, one unit** | yes | 0 shared cells, 0 unplaced, every company, before and after every gesture | **holds, absolutely** |
| **2 — a body stays whole** | partly | families whole: 91% clean → **37%** after a whole-company re-tidy (Northwind) | **holds on load, fails on the gesture** |
| **3 — children sit outward** | yes, since the compass | 11% nearer the centre than their parent (was 32%) | **holds, much improved** |
| **4 — one measure of distance** | partly | no structural test exists | **asserted, not proved** |
| **5 — lines follow, never lead** | **no** | — | **contradicted by the code** |

### Law 0 — the hand outranks the engine

The law names three tiers: **pinned** (never moved), **placed** (moved only
inside a branch you aimed tidy at), and **calculated** (free).

Only *pinned* exists. The tidy button is handed the pinned set and nothing else,
and then **replaces every hand placement on the map** with its own output. The
law's own words:

> **Tidy is aimed, not global.** … **Global tidy is a separate, named action**:
> throw the arrangement away and go back to calculated. **It asks first, because
> it is the one gesture that destroys work.**

Today there is one button, it is global, it does not ask, and pressing it a
second time clears the arrangement outright. **A person's placements have no
protection at all between "pinned" and "gone".**

### Law 1 — one cell, one unit

The one unambiguous success. Zero violations on every company, on a clean load,
after a drag, after a whole-company re-tidy. Several tests hold it. It has never
broken.

### Law 2 — a body stays whole

Holds well on a clean load — 91% of families are one connected patch on
Northwind. **It collapses under the five-second gesture applied widely:**

| families whole | clean load | after a whole-company 5s move |
| --- | ---: | ---: |
| Digital Tailoring | 50/59 | 40/59 |
| 1,000-person | 635/699 | 410/699 |
| Northwind | 1,530/1,686 | **616/1,686** |

More than half of Northwind's families come apart. This is `reflow` — the placer
that does not understand territories — being asked to re-lay 2,955 units.

### Law 3 — children sit outward

The compass (2026-10-14) did what three previous attempts could not: curl-back
went from 32–35% to 7–13% across all companies, and chains are now 99% dead
straight. **This law is in good shape.** It is still the cheapest of the four
that can conflict, and it yields correctly.

### Law 4 — one measure of distance

The rule is real and is now read from both sides. But the law says its proof is
*"not visible on a map: nothing outside the atlas calls a spacing function —
code check, by test"*, and **no such test exists.** The claim is currently held
up by the comments in the files that make it.

### Law 5 — lines follow, they never lead

> **The engine may not move a unit to improve a line.** No exception clause.

`tidy.ts` chooses which way to rotate a whole branch by scoring
`-(cousinHits * 10 + siblingHits)` — the number of connection-line crossings the
rotation would cause. Facing the right way is worth `outward * 0.5` and the code
calls it *"the tie-break"*.

**So the dominant term in that placement decision is what it does to the lines.**
This is precisely the failure mode the law was written to forbid, and the law
even predicts its consequence:

> Routing and keeping a territory whole are *opposed* objectives… on a small
> branch there are few chains and the territory wins; on a big one the crossing
> count outvotes it.

There is no test for Law 5 anywhere.

---

## 3. Contradictions a reader cannot see

**☑ Fixed the same day.** Greg: *"on Hex we should not be observing old laws or
codes — almost at all."* The hex engine now cites `MAP-LAWS.md` and nothing else;
purity has been given a home there as a standing requirement rather than
borrowing a number that means something else; and `MAP-LAWS.md` now says in its
opening that it is the only law set the hex map answers to, and why. What follows
is the record of what was wrong.

**Two different law sets, both called "the laws", with colliding numbers.**
The orbital engine has four laws from 2026-09-23
([LAYOUT-ENGINE-PROMPT.md](LAYOUT-ENGINE-PROMPT.md)); the map has six from
2026-10-07 ([MAP-LAWS.md](MAP-LAWS.md)). They clashed:

| number | orbital engine (older) | map laws (current) |
| --- | --- | --- |
| 1 | the picture is a pure function of the company | one cell, one unit |
| 3 | an authored placement is an obstacle | children sit outward |
| 4 | never overlap two bodies | one measure of distance |

**The hex engine's own test file uses the older numbering.** A test called
*"Law 4 — nothing sits on top of anything else"* is proving what the current law
set calls Law 1. Anyone reading a test name to find out whether a law holds will
get the wrong answer.

**The hex map is sized by circular geometry.** Deeper than the numbering, and
found while fixing it. The size of a hexagon cell — the number every other size
on the map derives from — is computed as the radius of a *ring of seats orbiting
a disc*, borrowed from the orbital engine, along with the drawn size of a node,
the size of a person, and how work marks sit around somebody. The hex study
already learnt once that circular geometry is wrong here — `people.ts` exists for
that reason — and the lesson was applied to where people stand but not to how big
anything is. Logged in [TASKS.md](TASKS.md); worth settling before a radial
rewrite, not after.

**`MAX_HALO` is doing two jobs.** It is documented as a load-time decision, and
it is also the only thing stopping a division's clear ground growing without
limit. At 12 it is clipping the top of the two largest companies — every unit
owed anything at the top rungs is owed exactly 12, which is the cap, not the
rule.

---

## 4. What the screenshot actually shows

Three faults, stacked. Only one is about dragging.

### (a) The clump — the gesture compresses the company

The five-second move applied to the whole of Northwind:

| | clean load | after |
| --- | ---: | ---: |
| how much ground the company covers | 285 × 277 | **112 × 99** |
| children touching their family | 86% | 72% |
| families whole | 91% | **37%** |
| nearer the centre than their parent | 11% | 29% |

The company is squeezed into about a sixth of its area. `reflow` packs
node-by-node into whatever is free and has no concept of the ground a family is
owed, so the atlas's entire spacing structure is discarded. **The tidy button
afterwards makes the span slightly smaller still**, so there is currently no way
back short of clearing the arrangement.

### (b) The long lines — a node sits in the middle of its own territory

This one is on a **clean load** and has nothing to do with dragging.

Across Northwind's 127 territories of 20+ units, a unit's chain home is on
average **0.85× the radius of its own territory**. Only **6 of 127** sit near the
door facing home; **52 of 127** have a chain longer than 80% of their own radius.
The worst is a 103-tile line.

`territory.ts` says in its own comments that *"the unit's own node is the seed of
its ground, and the way home arrives at it — so everything else grows forward
from here."* That is the intent and it is not what happens: children fan over a
half-turn centred on the unit's bearing, so they wrap round the node rather than
growing away from it, and the node ends up roughly central. **Every parent-to-
child line therefore crosses most of a territory.** That is the spaghetti.

### (c) The scattered outliers

132 units on Northwind sit further from their nearest relative than their own
clear ground explains. **Not one of them is a person** — all 132 are structural
nodes with reports of their own, all have 3–5 siblings, and all are owed the
capped 12 tiles. They are divisions whose *sibling territories are so large* that
their nodes cannot be near each other.

So (b) and (c) are the same fault seen twice: **the map is built out of big
blobs whose capitals are in the middle, and the lines between capitals have to
cross the blobs.**

---

## 5. On "atlas"

Worth stating plainly, because it has caused a misunderstanding.

**The atlas is not an abandoned idea. It is the layout engine running today.**
`territory.ts` *is* the atlas, `allocateByTerritory` is what the lab calls on
every load, and the lab's `shape` toggle is set to `atlas`. The thing that was
moved away from is the **archipelago** — the older `allocate.ts`, which treated
the map as islands of teams on an open plane and is still present behind the
other toggle.

The atlas is also the only one of the three placers that holds real opinions
about how a company should be laid out: nested territories, ground reserved per
family, gaps proportional to what they separate. **Those opinions are not the
problem.** The problem is that two other pieces of code re-decide the result
afterwards without sharing them.

---

## 6. What this points at

Stated as findings, not as a plan.

1. **The frontier is real.** Inside `reflow`, "stay with your family" and "keep
   your clear ground" compete for the same cells, because the atlas *grows* the
   ground to make room and `reflow` must fit into the hole that is there. Four
   mechanisms were tried against this on 2026-10-14 and every one traded one of
   Greg's complaints for the other. No weighting solves it.
2. **A search is the common factor.** Nearly every fault this fortnight comes
   from a packer hunting for a cell that satisfies competing rules and travelling
   when it cannot find one. Concentric rings would delete the search: the rung
   sets the radius, the bearing sets the direction, and the only question left is
   which cell on that arc.
3. **Half of a radial scheme already exists.** The compass gives every unit an
   absolute bearing derived from the shape of the company before any packing
   happens. Rings are the other polar coordinate.
4. **A ring also fixes (b).** If a unit sits on ring *n* and its children on ring
   *n+1*, every chain is one ring long by construction, and a capital is always
   at the edge of its own ground facing home. The two worst things in the
   screenshot stop being possible rather than being tuned away.
5. **The untested case is a wide rung.** A ring has a fixed circumference, so a
   unit with ninety children has to spill or compress. No demo company has more
   than five children anywhere. This is the thing to test first, before
   committing.

---

## Where the evidence is

Every figure here is reproducible from `lib/map/layout/hex/` with no browser.
The probes used were scratch scripts; the durable ones are
`npm run hex:confetti` and the test suite (759 passing, 1 expected fail).
Measurement history is in [HEX-LAYOUT.md](HEX-LAYOUT.md); the laws are in
[MAP-LAWS.md](MAP-LAWS.md); open items are in [TASKS.md](TASKS.md).
