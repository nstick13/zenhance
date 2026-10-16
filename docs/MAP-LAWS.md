# The laws of placement

**Agreed with Greg, 2026-10-07.** This is the governing theory for where things
sit on the hex map. It is short on purpose. Anything longer than this belongs in
[HEX-LAYOUT.md](HEX-LAYOUT.md), which is the working record; this file is the
part that does not move.

It exists so that an agent arguing about placement argues with a document in the
repo rather than with somebody's memory of a conversation. **If the code and this
file disagree, the code is wrong.**

**This is the only law set the hex map answers to.** The orbital engine has four
laws of its own, written 2026-09-23 and held by
`lib/map/layout/__tests__/laws.test.ts`. They do not apply here and must never be
cited here, because the two sets share the word *law* and their numbers
**collide** — the orbital Law 4 is *never overlap two bodies*, which is this
set's Law 1, while this set's Law 4 is *one measure of distance*.

That is not a hypothetical. The hex engine's own test file carried the orbital
numbering from the day the study began until 2026-10-15, so a test named *"Law 4
— nothing sits on top of anything else"* was proving Law 1, and anyone reading a
test name to find out whether a law held got the wrong answer. Greg, 2026-10-15:
*"on Hex we should not be observing old laws or codes — almost at all. Hex should
almost be a completely clean build inspired by, but not copying, the earlier
orbital model."*

---

## The one sentence

**Laws gate. Preferences choose.**

A law says where a unit may *not* go. A preference picks among the places the
laws allow. A preference may never win an argument with a law.

That sentence is the whole fix. The map's long-running fault — Greg called it
confetti — was one preference (*fewer crossing lines*) quietly overruling one
law (*a family stays whole*). Nothing was broken. Two reasonable things were
competing with no rule about which won.

---

## Why they are ranked

The laws are **strictly ordered**. A lower law yields to a higher one, always,
and says so in its own clause. Without the order they are a wish list: every
pair of them can be made to conflict, and the code then settles it by accident —
which is how we got here.

---

## Law 0 — The hand outranks the engine

> **The engine may never move a pinned unit.**
>
> **The engine may not move a placed unit, except inside a branch a person has
> aimed tidy at.**
>
> **A person's placement is never improved on the engine's own initiative.**

**Why it is above the rest.** On 2026-10-06 Greg made a 1,258-cell arrangement
of the 2,562-person company by hand. It beat the engine on *every* cohesion
measure — a third fewer people sitting next to strangers — and it used about five
times the area. The engine's taste is not better than his, so it has no standing
to correct him.

**The interlock that matters.** A hand placement only *becomes* a placement if it
satisfied Law 1 at the moment it was made. So Law 0 can never shelter two units
on one cell: it protects placements that exist, and a placement does not exist
until it is legal. **That interlock is what was missing** when these were a list
rather than an order.

### The three tiers

| tier | what it means | may tidy move it? |
| --- | --- | --- |
| **pinned** | "I mean this one." Deliberate, marked on the tile, revocable one at a time. | **Never.** |
| **placed** | "This is where I put it." Persists, survives reload, travels with its parent. | **Only inside the branch you aimed tidy at.** |
| **calculated** | The engine's own choice. | Freely. |

**Tidy is aimed, not global.** Picking the same node up again within five seconds
aims tidy at that branch, and *aiming tidy is the consent*. Inside that branch,
placements are released and spacing is restored. Pins are not touched. The unit
you aimed at keeps its cell — that is where your hand let go — and everything
beneath it re-trees around it.

This is what makes the laws survivable in use. A blanket "never touch a hand
placement" would retire the tidy button after a dozen drags, which was Greg's
own objection to the first draft: *"If we blanket state that we can't overwrite a
manually placed team/group, and there are many manually placed groups, the point
of the tidy function ceases to function."*

It also means **nothing is ever permanently stuck**. If one of your drops curled
a team back toward the centre, aim tidy one rung up — at the parent — and the
offending unit is released with the rest of that branch.

**Global tidy is a separate, named action**: throw the arrangement away and go
back to calculated. It asks first, because it is the one gesture that destroys
work.

---

## Law 1 — One cell, one unit

> **The engine may not place two units on one cell, nor leave any unit without
> one.**

No exception clause. Nothing overrides this, including Law 0. A drop that cannot
satisfy it is **refused** — not approximated, not nudged into something that
nearly works.

---

## Law 2 — A body stays whole

> **The engine may not break a unit's ground into pieces — not a team, not a
> division, not anything in between — except where that would conflict with
> Law 1.**

A territory is one connected piece at every rung. **Pieces exist only where a
person made them.** Greg, 2026-10-04: *"Teams of humans should be forced
together until a user separates them. So the point is we allow exclaves, but
only when they are manually created."*

One permitted exception, and it must be visible: when the ground genuinely runs
out, a body may be placed outside its own division **flagged as outside it**,
rather than quietly scattered.

This law also answers *what travels as one body when I drag* — a territory, at
whatever rung you grabbed. Not a flat team id.

---

## Law 3 — Children sit outward

> **The engine may not place a team, or anything above a team, nearer the centre
> than its own parent — except where that would conflict with Laws 1 or 2.**
>
> **An individual person is pushed outward, never forbidden from the near side.**

Equal distance is allowed; nearer is not. The split is deliberate: a team lead
belongs at their team's door, on the home side, so for a person this is a cost
and not a wall.

**Why the law states the goal and not a mechanism.** Greg, 2026-10-06: *"if my
child sits at an angle to my source spine, then its child will similarly sit at
an angle, and since we're using hexagons, we end up with spirals within four
steps."* A rule based on relative angle compounds at every rung, and six turns
is a circle, so a branch meets itself within four. Any mechanism that drifts
like that is the wrong shape of rule. State the outcome; let the packer find it.

**And the mechanism that finally served it, 2026-10-14: the compass.** Three
rules were tried and all three were *relative* — facing by birth order, facing
read back off the placement, a penalty on the home side — and the number sat at
32–35% through all of them. Measured on the 1,000-person company: of the 408
units nearer the centre than their parent, **only 151 were also behind their
parent**. The other 257 sat forward of their parent and still ended up nearer
the middle, where no relative rule can see them.

So the bearing is now worked out for the whole company **before anything is
packed**, from the shape of the tree alone: the root owns the circle, and every
unit hands its children an arc centred on its own bearing. An arc is an absolute
bearing, so it cannot accumulate — and it costs one pass over the units, so it
replaced a placement rather than adding one. Measured: **35% → 7%** on the
45-person company, **32% → 13%** on the 1,000-person, **32% → 11%** on Northwind,
with chains dead straight 94% → 99% and the layout no slower. It costs width:
+7% and +27% respectively on the two larger companies.

**This law yielding to Law 2 is not theoretical.** Charging every unit the full
price of sitting behind its parent took teams whose children all touch them from
90% to 86% — a team stopped reading as one thing. A leaf is now held to its
parent's doorstep at a price no bearing can outbid, which is precisely what
*"pushed outward, never forbidden from the near side"* has to mean in code.

---

## Law 4 — One measure of distance

> **The engine may not hold more than one rule for how far apart things sit, nor
> apply a different one because a hand is involved — except where that would
> conflict with Laws 1 to 3.**

**The rule, since 2026-10-16: the spacer.** Greg: *"all nodes — human and
structural — have a one hexagon space around them. That is to say, each side of
the hexagon representing that human or node gains a connecting hexagon that forms
its spacer. On load, or using the auto-tidy function, the only things that can
enter that node or human's spacer hexagons are humans in the same team or humans
that are direct children of a structural node."*

It is stated as **what may touch what**, and that is why it succeeded where four
distances failed. A distance has to be measured between two things and both of
them have an opinion about it, which is how one gap came to be decided by
whichever unit was owed the least. `mayTouch(a, b)` and `mayTouch(b, a)` are the
same question, so there is no side to read it from and nothing to reconcile.

Three things fall out of it that nobody had to ask for separately: two structural
nodes are never adjacent; two humans touch only if they share a team, so a team
is one crowd with clear ground round it; and a human touches a structural node
only if it is theirs. It lives in `spacing.ts` as `spacerRule`, and the radial
driver and `tidy` both read it from there. Measured: **nought breaches on every
company**, against 0.6%–100% under the atlas, which does not hold to it.

**Where the spacer sits in the order, decided 2026-10-16.** Greg: *"that spacer
rule trumps everything except our 0th law — nothing outweighs the hand."* It is
written in directly **below Law 1** rather than above it, and the difference
never comes up: Law 1 has no exception clause and a unit must always get a cell,
while Greg's own fourth rule — *"if the mapping produces a clash, grow the space
so that the clash can be resolved"* — means a spacer that cannot be honoured
makes the map bigger instead of forcing a choice. Measured: nought breaches on
every company, so the two have not yet had to compete.

**And the hand still outranks it**, which is Law 0 unchanged. Greg chose, the
same day, that a plain drop does **not** re-lay the branch it is holding: a
dropped branch keeps its own spacing and takes whatever boundary it lands on,
and re-laying stays behind the five-second re-pickup and the tidy button, where
aiming at it is the consent. So *"a person's placement is never improved on the
engine's own initiative"* stands as written.

**The older rule — *a gap is a share of the size of the thing it separates* —
still governs the atlas driver**, and still sets how far a parent holds its
children (`spacedBy`). The two are not in conflict: one says how far out a rung
sits, the other says who may stand next to whom. If they ever do conflict, the
spacer wins, because it is the one a reader can see.

**Tidy is handed the layout's figures, not its own.** `layoutTerritories`
records what it kept clear round each unit as `spacedBy`; `neaten` honours that
and holds no rule of its own. This is the whole of what "one measure" means in
practice, and the first build without it showed what the alternative looks like:
tidy packed the map until 79% of cells touched a stranger, against 53% on a
clean load, and the company collapsed from 145×149 to 128×77.

**Every gesture that re-lays a branch is handed the same figures — and that was
not enough.** Greg, 2026-10-14: *"the 5s placement feature bunches peer groups
together — it does not observe any spacing rules."* Handing the same figures to
both gestures left one half of the rule unasked: the re-pickup checked that its
own owed gap was clear and never that it was standing in somebody else's, so the
unit owed the least decided every boundary — and a person is owed nothing. **One
measure means one measure read from both sides.** Fixed 2026-10-14: units
squeezed inside a re-laid branch went 198 → 109 against a clean load's 85, and
on the 45-person company 8 → 0.

What remains is not a spacing rule but a second placer: the tidy button and the
atlas both move *whole bodies* and measure the ground round all of them, while
the five-second path seats one node at a time and reserves nothing for that
node's family — so sibling teams land a respectable distance apart and their
people then grow into the gap. Sibling node spacing is still 2.7 against the
load's 4.6. The answer is the ownership table below, applied: retire the second
placer. The tidy button and the five-second re-pickup are the same gesture at
different scopes, so they space identically. A plain drop is handed nothing, because Law 0 says
where a hand puts something is not the engine's business to improve. The
five-second path was the one hole left when the drop path's old rule was
removed: it took its spacing from the same function and so got none, and jammed
a re-treed branch to zero gap — Greg, 2026-10-14: *"that pushes everything
together so the gap between anything is zero, which means it's not applying the
same rules as the auto-tidy. To me that feels inconsistent."* Measured on
Northwind, crowding inside a re-treed branch went from **99% to 51%**, against
57% on a clean load.

**Spacing is a preference, not a gate — and that is the ranking doing its job.**
Letting a branch move out to where its owed gap is available halves the crowding
and breaks branches apart, 47 of 58 whole down to 31. Law 2 outranks Law 4, so
the branch sits against its family and the room comes from choosing which cell.

A hand drop may land things tighter than the rule — that is Law 0. What the
engine may never do is impose a second, tighter rule of its own.

### The dial, and the two guardrails

A user-facing spacing setting is coming — *none · tight · normal · loose*. It is
**one dial on the one rule**, not a second rule: the dial *is* the share.

```
none ≈ 0      tight ≈ 1/6      normal = 1/3 (today)      loose ≈ 2/3
```

- **One number, every boundary.** The dial must never become a table of values by
  rung. That is precisely what made every boundary on screen about the same
  width — so none of them said anything about what it separated — and it is the
  measured cause of the confetti appearance. Measured: a division got air worth
  4% of its own width while a pair of people got 100%, an inversion of about
  twenty-five times.
- **The laws survive every setting.** At *none* the map reads as a continent:
  still no overlap, still no body in pieces, still nothing curling inward. The
  character changes; nothing becomes illegal. That is a useful test of whether
  this law set is well formed.

**Changing the dial re-lays the ground**, so existing placements land on a
differently-sized map and a few may now collide. Law 1 refuses them rather than
stacking them, so they are **reported**, not silently dropped. For that reason
the dial is a per-viewer view setting.

### The cap is a decision, and it is written down

`GAP_SHARE = 1/3` is the only number in the spacing *rule*. Left alone the rule
settles at a halo of 119 tiles round the master centre of the 2,562-person
company — the *"HUUUGE"* centre Greg asked for on 2026-10-03.

There is also a cap on it, `MAX_HALO`, and it is **a design decision rather than
a safety rail**. That distinction is not pedantry: the constant was called
`MAX_TIER_GAP`, a stale line in `HEX-LAYOUT.md` called it 5, and a rule set
drafted on 2026-10-07 proposed "keeping" a cap of 5 that had never been in the
code. Greg: *"the spacing gap cap at 5 is invented. We can revoke it."*

**It is 12, chosen 2026-10-14 for load time.** Measured on Northwind with people
as the smallest unit:

| cap | layout | touching family | curl-back |
| --- | ---: | ---: | ---: |
| 3 | 0.8s | 86.5% | 33.6% |
| **12** | **1.4s** | **86.5%** | **32.1%** |
| 24 | 4.9s | 86.5% | 34.0% |
| 48 | 6.6s | 86.5% | 35.0% |

Cohesion is identical at every setting and curl-back is slightly better at 12,
so the halo buys width and nothing else measurable. Greg, asked to choose, took
the 4.7× speedup: *"the 'people' view now takes an insane time to render."*

**One line gives the centre its full width back.** Wanting both is what the
parked lazy per-team interiors work (`hex-lazy-interiors`) is for, and that is
the real answer.

---

## Law 5 — Lines follow, they never lead

> **The engine may not move a unit to improve a line.**

No exception clause — this one cannot conflict with anything, because it is a
statement about the order things happen in. Every unit gets its cell. *Then*
chains are drawn. No placement may be chosen by what it does to a chain, ever,
in any path.

**It is broken today, in one place, and it is marked in the code.** `neaten`'s
turning phase in `tidy.ts` chooses which way to rotate a whole branch by counting
the connection-line crossings each rotation would cause — cousins weighted ten to
one — with facing the right way as the tie-break under it. So the dominant term
in that placement decision is what it does to the lines, which is the one thing
this law forbids outright. Found 2026-10-15; see `docs/MAP-REVIEW-2026-10-15.md`.

**Why it earns a law.** Routing and keeping a territory whole are *opposed*
objectives: shortening a chain pulls a branch toward its parent, and territory
integrity pushes it out. On a small branch there are few chains and the territory
wins; on a big one the crossing count outvotes it. That is the best available
explanation for why two or three rungs behaved and more did not.

It is also the most-repeated lesson in this engine's history: **four separate
problems that looked like line-drawing problems turned out to be placement
problems.** Sweeping turn costs from 12 to 500 moved "dead straight" from 73% to
75% and cost 36 chains driven under strangers. The atlas, which never consults a
route, delivered 88% dead straight on its own.

---

## These are preferences, not laws

Each may choose between placements the laws permit. None may choose a placement a
law forbids.

- fewer crossing lines
- shorter chains, tighter packing
- a map that looks neat
- how fast the layout runs
- **likeness: the closer two things are on the tree, the closer they should sit**
  (Greg, 2026-10-16). It is a preference and not a law, which is the only way it
  can coexist with Law 4 — the spacer decides which cells are legal and likeness
  chooses among them. *Laws gate, preferences choose.* So "aggressively biased"
  has a ceiling: likeness may never outbid the spacer or Law 3.

  **It already holds on average and nobody has a lever on the rest.** Mean
  distance in cells rises with every step of tree distance, under both drivers,
  and roughly a third of individual pairs still invert. Two attempts at the
  inversions — clustering siblings into the arc they need, and putting the
  heaviest child on its parent's own bearing — both made them *worse*, because
  what dominates is radial stretch and the spacer is what causes it. See
  HEX-LAYOUT.md § Likeness.

---

## One owner per question

| question | owner | what everything else becomes |
| --- | --- | --- |
| where does a unit go | the atlas (`territory.ts`), through one of its two drivers | nothing else places anything |
| what travels as one body | the atlas | the flat team id is deleted |
| how far apart | `spacing.ts`, read by both drivers | the drop path holds no spacing rule |
| what happens on a clash | the drop engine | obeys Laws 1 and 2, holds no spacing rule |
| where a line goes | the router | reads placement, never writes it |

### What a clash does

Not a law — this is what Laws 1 and 2 leave you with when two things want one
cell. **Whoever is already there stays.** The arriving unit yields, in order:

1. The nearest free cell **that still touches its own team** — Law 2 before
   convenience.
2. If there is none, **the whole team moves as one**, staying inside its own
   division if there is room — Law 2 again.
3. If the division is full, the team takes the nearest free ground outside it,
   **visibly flagged** as outside its division — Law 1 wins, and Law 2's breach
   is declared rather than hidden.

One drop is one undo step, so an experiment in front of a client is reversible.

---

## How you know a law holds

Neither Greg nor Nate reads code, so a law that can only be checked by reading
code is not checkable. **Every law owes a number on the lab panel, counted from
what is drawn** — never from the calculated layout, and never from the database.

This matters because it has already gone wrong twice. On 2026-10-06 the panel
reported *91% of children touch their family* while Greg could see named people
plainly adrift. The figure was computed on the calculated layout and copied
unchanged through the memo that applies hand placements. Counted live it was
**86%, with 400 units not touching**. Both numbers were correct; they were about
different maps.

| law | the number that proves it | state |
| --- | --- | --- |
| 0 — the hand | placements honoured, *n* of *n* | to build |
| 1 — one cell, one unit | two-on-a-cell count; unplaced count | on the panel |
| 2 — a body stays whole | whole families; cells pressing against another division; people next to a stranger | on the panel, counted live |
| 3 — children sit outward | % of units nearer the centre than their parent | on the panel, counted live |
| 4 — one measure of distance | not visible on a map: nothing outside the atlas calls a spacing function | **structural since 2026-10-16** — the rule lives in `spacing.ts`, both drivers import it, and `radial.test.ts` checks the figures reported are ones that file could produce |
| 5 — lines follow | tidy produces identical cells with routing switched off | **to build — and the law is currently broken** |

And four standing requirements that are not laws but are not negotiable either:

- **The geometry is the lattice's.** This map is a beehive, not a dial. Every
  size, gap and clearance is worked out from the lattice — counting cells, and
  the edge-touch between two hexagons — and never from a circumference, an arc
  length or a true radius. The hexagon's own inradius ratio, `2/√3`, is the
  constant that does this work: the narrowest gap between two concentric
  hexagons is at the middle of a side, so a dot needs that much more
  circumradius to clear a boundary.

  Greg, 2026-10-15: *"if we use a 'radial' layout driver, this will be within the
  parameters of a hexagonal grid, not based on a true circle or, as such, radius.
  Therefore calculations relating to the radial geometry should not use things
  like π but instead the lattice/beehive layout geometry, edge-touch calculations
  and the like."* **A ring is a ring of cells.** Its size comes from counting
  lattice steps outward, and its capacity from how many cells are on it — never
  from `2πr`.

  Angles are still allowed, because a bearing is a real thing on a lattice too —
  six of them — and `hexRingParam` maps one onto a hexagonal ring. What is
  forbidden is deriving a *distance* or a *capacity* from a circle.

  This was written down because the map spent its first fortnight sized by one:
  the cell's size came from the radius of a ring of seats orbiting a disc, so
  the formula that decided how big a hexagon was had no relationship to the one
  that filled it. Fixed 2026-10-15; see `cellRadiusFor` in `people.ts`.

- **The picture is a pure function of the company.** The same company gets the
  same cells, every time, whatever order its units arrived in — no randomness, no
  settling pass, no dependence on the viewport or the window size. Held by tests
  in `hex.test.ts` and `territory.test.ts`.

  It is written here rather than numbered because it is not a rule about *where*
  anything goes, which is what every law above is; it is a promise about the
  engine being a function at all. It was the orbital engine's own Law 1, and
  until 2026-10-15 the hex tests still called it that — which is exactly how the
  two law sets got mixed. It needed a home of its own.
- **Measure what is drawn.** Every figure on screen comes from the live
  arrangement.
- **Divisions in one piece is measured, not enforced.** If bodies stay whole and
  nothing curls back, divisions should hold together on their own. We report it
  and watch it.

---

## Two drivers, one owner (2026-10-16)

`territory.ts` now has **two** ways of deciding where a unit goes, and
`allocateByTerritory` is still the only entry point to either. The `atlas` driver
packs each territory as the exact shape of its contents and searches for
somewhere to put it. The `radial` driver gives every unit a band and an arc and
deletes the search — Greg, 2026-10-16, chose **ragged rings**: each branch stacks
its own bands outward from its parent rather than sharing one global set of radii.

**This is not a second placer.** The thing Law 4 and the owner table forbid is
two pieces of code holding their own ideas about spacing and reaching different
answers, which is what the five-second re-pickup was. Both drivers read the one
spacing rule from `spacing.ts` and the one fan rule from `compass.ts`, and both
come back as an ordinary `Allocation` with its stats counted the same way, so
nothing downstream learns there is a choice.

**Both are kept only until one wins.** That is how the atlas arrived beside the
archipelago, and the archipelago was deleted on 2026-10-15 when it had lost.
Measured so far: radial wins the teams view on every line, and trades nine points
of adjacency for a tenfold reduction in area in the people view. See
[HEX-LAYOUT.md](HEX-LAYOUT.md) § The radial driver and [TASKS.md](TASKS.md).

**Wide fans are no longer untested.** The note below said no unit in any demo
company has more than five children and that nothing had been tested against the
ninety pods a practitioner described. The radial driver has been: with arcs shared
by subtree weight, an 86-child parent's band offers 85.7 cells for its 86
children, and every unit is seated. The atlas is still untested against it.

---

## What this file deliberately does not settle

- **Theme as the grammar of sibling order.** Greg wants similar things side by
  side. Disciplines exist per *person* in the database; units carry no such
  field. Today the order is lead first, then headcount descending, then name.
  Theme is new build.

  **Narrowed 2026-10-16.** Greg defined *alike* as closeness on the tree, which
  needs no new field — and that turned out to settle less than it looks, because
  every pair of siblings is the same distance on the tree, so it cannot order
  them at all. He has said the real answer is real fields, *"eventually"*. Until
  then the nesting delivers tree-distance-to-proximity on average and nothing
  orders peers but size and name.
- **How a last-resort exclave is drawn** when Law 2's exception fires.
- **Wide fans.** No unit in any demo company has more than five children. A
  practitioner we spoke to ran ninety pods. Nothing here has been tested against
  that.

---

## Where the evidence is

- [HEX-LAYOUT.md](HEX-LAYOUT.md) — the working record: every measurement, every
  dead end, every engine seam.
- [HEX-RULES-BRIEF.md](HEX-RULES-BRIEF.md) — the 2026-10-06 hand-off that
  diagnosed the contradictions these laws resolve.
- [TASKS.md](TASKS.md) — what is still open.
- `lib/map/layout/hex/` — the engine, one concern per file.
