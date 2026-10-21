# Tasks

Loose ends, decisions waiting on a human, and things noticed in passing that
would be wrong to fix silently inside someone else's change.

**Two audiences, and the order matters.** Greg and Nate don't code, so every
item starts with a plain-English paragraph: what it is, why it matters, and
what — if anything — is being asked of them. The detail an agent needs comes
after, under *For whoever picks it up*. **If you add a task and can't write
the plain-English part, you don't understand it well enough yet.**

**This list is for every agent — Claude, ChatGPT/Codex, whoever comes next.**
The repo is the only channel we share, so a task that lives in a chat window
does not exist.

Not a roadmap. [ROADMAP.md](ROADMAP.md) is what we are *building*; this is
what is *outstanding*. If an item turns out to be a feature, write it up there
and leave a one-line pointer here.

## How to use it

- **Taking one?** Change `☐` to `▶`, add your name and the date, and **push
  that before you start**. An unpushed claim is invisible, which is how two
  agents end up doing the same work.
- **Done?** Change it to `☑`, add the commit's first line, move it to
  *Recently done*. Delete anything there older than about a month.
- **Blocked on Greg or Nate?** Leave it under *Waiting on a decision* and say
  plainly what the question is. Don't guess, and don't let it quietly rot.

Status: `☐` open · `▶` in progress · `☑` done · `⏸` parked deliberately

---

## 🔴 Blocking a release

### ☐ Tell the database about the new column before anything goes live

The app keeps its data in a database, hosted by a company called Neon. When we
add a new *kind* of information, the database has to be told about it first.
That instruction is called a **migration**.

We added one: every node on the map can now remember **how far it sits from
its parent**. The code that uses it is ready. The database has not been told.

**If we release before telling it, the map page breaks** — anyone opening
`/org` gets an error page instead of their company. The rest of the app keeps
working; it is the map, not the whole site.

The fix takes about a minute: paste one line into Neon's web console. It has
to be Greg or Nate, because it touches the real customer database and that is
never an agent's call.

> **This has bitten us before.** In ROADMAP.md, migration `0005` went out in
> the wrong order and took every page down, not just one.

*For whoever picks it up:* `lib/db/migrations/0009_mute_longshot.sql` is on
`next`, not on `main`; it arrived in `151810d`. `getOrbitalNodes` in
`lib/data/queries.ts` does `db.select()`, so it asks for every column Drizzle
knows about and throws until `distance` exists. Called from
`app/(app)/org/page.tsx`. `requireWorkspace` doesn't touch `orbital_nodes`,
which is why the blast radius is one page. Paste the **bare SQL** into Neon's
editor — wrapping it in `psql ... -c '...'` gives `syntax error at or near
"psql"` (SQLSTATE 42601).

```sql
ALTER TABLE "orbital_nodes" ADD COLUMN "distance" numeric(12, 3);
```

---

## 🟡 Waiting on a decision

Agents should not settle these alone. Each changes how the product feels or
what it costs, and that is not a refactor's call.

### ☐ A view built around people, not the org chart — *raised by Greg, 2026-10-02*

Everything the hex map draws is the **organisation**: cells are units, colour is
territory, lines are reporting. People are the smallest thing on it — dots
arranged around whichever box they report into. Greg, after seeing the first
version of that: *"we might need a rethink on how we view humans rather than the
org."*

That is a hunch rather than a decision, and it is written down so it is not lost
and so nobody mistakes the current arrangement for a settled answer. The
observation behind it is real: a fifty-person team is fifty identical grey dots
in a ring, which says how many people there are and nothing whatever about who
they are, what they do, or who they work with. The org chart answers *where does
this box sit*. It does not answer *who is this person*, and those may want
different pictures rather than two zoom levels of one picture.

**Nothing is being asked yet.** When Greg wants to take it further, the question
to settle first is what a person-first view is *for* — finding someone, seeing
who works with whom, seeing where effort is going — because each of those wants
a different layout and only the first is served by the map we have.

*For whoever picks it up:* people are placed by `lib/map/layout/hex/people.ts`
(hexagonal rings round a node, lead by the chain) and drawn in
`app/lab/hex/HexLab.tsx` §7. The constraint that shapes the current answer is
that a person must stay inside their unit's own cell — which is exactly the
constraint a person-first view would be questioning. See *Where the people
stand* in [HEX-LAYOUT.md](HEX-LAYOUT.md).

### ⏸ Break orbits is a one-way door — *parked by Greg, 2026-09-25*

"Break orbits" lets you move nodes freely, ignoring the rings. Turning it on
**replaces its own button with a label**, so there is no way back. The only
route to normal orbits is "Tidy up" — which also throws away every placement
you just made.

So: break orbits to look at something, want your rings back, lose your work.

**The question, for when you want it:** coming back to orbits, should your
free placements be *kept* (the map stays as you left it; snapping applies only
to what you move next) or *re-snapped* (everything springs back to the
calculated layout)? Same effort either way; completely different feel.

*For whoever picks it up:* `components/viz/orbital/OrbitalMap.tsx` ~line 2874.

```jsx
{snapping ? (
  <button ... onClick={() => { ...; setSnapping(false); }}>Break orbits</button>
) : (
  <span role="status" style={S.modeIndicator}>Whiteboard mode</span>
)}
```

`setSnapping(true)` exists in exactly one other place — `resetArrangement`,
which also clears `overrides`, `angleOverrides`, `unitOffsetsRef`,
`seatOffsetsRef` and the saved `orbital_nodes` rows. Pre-existing; noticed
2026-09-24 while extracting the growth engine. Context in
[ORBITAL-INTERACTION.md](ORBITAL-INTERACTION.md).

### ☐ Moving a node two ways gives two different results

There are two ways to move a node: drag it across the map, or drop it in the
basket and pull it out somewhere else.

With "Break orbits" on, those two routes behave **differently**. One plays a
small ripple and counts the move as a placement; the other just moves the node
silently. Nobody decided that — it is an accident of the two paths having been
written separately, at different times.

**The question:** should free placement give you feedback, or stay quiet?
Break orbits is described in our own notes as *"a way to look, not a way to
arrange"*, which argues for quiet — but the basket route has been shipping the
noisy version, and it may simply feel better.

*For whoever picks it up:* `lib/map/growth/drop.ts` carries a ⚠️ block
explaining it, and a test pins each side so neither drifts further. The basket
route arrives with a free `InsertionPlan` and commits through `commitPlan`
(ripple + `setSessionPlaced`); the map route arrives with no plan and has its
delta applied raw.

### ☐ Is dragging a large branch a feature, or a side effect? — *raised with Greg, 2026-10-19*

Anything on the map can be picked up and put somewhere else: a person, a team,
or a region holding 1,258 units. The small gestures are obviously useful and
nobody questions them. **The large one was never designed.** It exists because
the engine treats every node the same way — not because we decided a user
should be able to carry a quarter of the company across the screen and drop it.

A week of work now hangs off that gesture: the rule that makes a moved node
answer to master-centre by distance, the dial that sets how fast it does, and
two of the open faults further down this list. All of it is machinery for
making an undesigned gesture behave.

**The question for Greg:** should a user be able to pick up a large structural
node at all? Three answers are live, and they lead to different work.

- **Keep it.** The gesture stays general, and we go on paying for it in rules.
- **Gate it by size.** Above some headcount the map offers something else —
  the basket, or "put this unit under that one" — and the free drag is for
  things small enough to land where you aimed.
- **Replace it.** Big structural change becomes an explicit instruction and the
  engine decides the geometry; dragging stays for arranging what you can see.

Nothing is broken and nothing is waiting on this — `lab` is in a good state.
It matters because it decides whether the two drag faults below are worth
fixing, or whether they go away with the gesture.

*For whoever picks it up:* the radial drag path is `deferBranch`
(`lib/map/layout/hex/defer.ts:225`), called on every cell crossing from `reLay`
in `app/lab/hex/HexLab.tsx`; the atlas still uses `relayBranch` + `restBranch`
in `territory.ts`. A size gate belongs where the gesture arms, not inside the
layout. Both *Dragging a big branch costs six frames per mouse move* and *The
drag path still thinks the map is an archipelago* are work on this same
gesture.

### ☐ The maths is right and the result still surprises you — *raised by Greg, 2026-10-19*

Moving a deep node far from the centre produces exactly what the rules say it
should, and not the picture Greg expected. His words, watching it:

> "The spacing rules on moving a deep child node result in a very linear
> scattering of the child branches — which does resemble an org chart indeed.
> My idea has not implemented as I thought it would… I need to think on how
> this can work more… predictably for a user."

And the round after: *"math and reality collide to produce elongated less
legible results."*

The worst symptom is fixed — leaf clustering comes back at the far end of the
dial, so a far-flung branch reads as a circle rather than a chart (`3f81323`).
The question underneath it is open: **what should a user be able to predict
before they let go?** Today the honest answer is "nothing precise" — you find
out where a branch lands by dropping it and looking.

Three directions, not exclusive:

- **Show the landing before the drop** — a ghost of where the branch will sit,
  so there is nothing left to predict.
- **Constrain where it may land**, so the prediction is easy to hold in your
  head even when the geometry underneath is not.
- **Accept the surprise**, and make undo cheap and obvious.

**Greg is thinking about this one himself.** It is written down so it isn't
lost, not as a job for an agent to go and solve.

*For whoever picks it up:* the rule is deference `δ = floors[depth] /
distance(hand, centre)`, capped at 1 and arriving over `taper` rungs
(`TAPER_RUNGS`, `lib/map/layout/hex/defer.ts:150`; the **wedge** dial in the lab
panel offers 1, 2 or 3 rungs so the settings can be compared side by side).
`npm run hex:zoning` measures what a drag costs in teams kept whole, spacer
breaches and family adjacency. The reasoning is written up in
[HEX-LAYOUT.md](HEX-LAYOUT.md).

### ☐ We lost the panel that surfaced problems

The old **Radial** map — deleted on 2026-09-24 — carried a side panel called
the *findings rail*. It surfaced things worth knowing: people allocated over
100%, teams with no owner, gaps against the ideal team shape. That map also
showed the **formal reporting lines** (the HR org chart) as something distinct
from how work actually flows.

Both disappeared with it. **The calculations are completely intact** — nothing
was deleted except the display — but there is currently nowhere to see them.

This was not an accident of the clean-up alone: the roadmap entry asked for
both to be moved onto the new map *first*, and that never happened. It is
recorded loudly in ROADMAP.md rather than buried.

**Nothing is being asked yet.** Analytics is design-first in our own rules, so
this waits for that conversation rather than an agent rebuilding a panel
nobody has designed for the orbital map. Decide there whether it comes back,
in what form, and whether the untouched maths gets rebuilt on or deleted.

*For whoever picks it up:* the orphaned pure modules are
`lib/analytics/findings.ts`, `allocation.ts`, `gaps.ts`, `rollup.ts` and
`lib/canvas/myView.ts`, `moneyFlow.ts`, `allocationFlow.ts`,
`lineRouting.ts` — listed in [ENGINES.md](ENGINES.md) § *Currently
unreferenced, kept on purpose*.

### ☐ Make preview URLs private — one Vercel setting

`lab`, `next` and `release` each run on a real, working URL. Search engines
are now told to stay away from them, and the lab pages have vanished from
production — but **none of that stops anyone who has a link from opening
one.** Right now a preview URL is effectively semi-public.

The fix is one setting: **Vercel Deployment Protection**, set to require
Vercel authentication on all preview deployments. Then only people on the
team can open one.

Until it's on, previews are fine for invented demo companies and are not
somewhere to point a customer's real data.

*Greg or Nate — it's in the Vercel dashboard, not something an agent can do.*

### ☐ Give `release` a database of its own

The `release` stage exists to be a dress rehearsal — as close to the real
thing as we can make it, so a migration or a slow query fails there instead of
in front of a customer. See [ENVIRONMENTS.md](ENVIRONMENTS.md).

It can't do that job sharing the demo database. It wants a **Neon branch** —
Neon can make a copy of production's shape and volume with none of its
consequences — pointed at by `release` only.

**Two things to check or decide, both in dashboards, neither an agent's call:**

1. **What database do preview deployments use today?** If Vercel's preview
   environment variables were never set separately, every preview build has
   been reading and writing the **production** database. Five minutes in the
   Vercel dashboard settles it, and it matters more than anything else on this
   page.
2. **Create the Neon branch for `release`** and set `DATABASE_URL` for that
   branch's deployments. It costs something, so it is a call, not a chore.

Until that exists, `release` is a rehearsal in costume: better than nothing,
but it will not catch the volume-and-migration problems it is there for.

### ▶ Branches face the wrong way, so the map spirals back on itself — *Claude, from Greg 2026-10-06*

On `/lab/hex` in atlas mode, the line from a deep team back to the master centre
visibly loops over itself. Greg, 2026-10-06, seeing it on Northwind: the mapping
*"seems to loop back on itself."*

**Measured: 62% of units face a different direction from the one they were
placed in**, and 466 of them are more than 120° out. A unit's children grow
along its *spine*, and the spine was being set from accumulated birth order —
"you are the second child, so you are 60° off your parent" — rather than from
where the unit actually ended up. So a unit placed to the north-east can be
facing south-west, and its whole subtree grows back across its own parent. Every
rung adds another relative turn, so a branch spirals and meets itself. Greg:
*"if my child sits at an angle to my source spine, then its child will similarly
sit at an angle, and since we're using hexagons, we end up with spirals within
four steps."*

A related number: 35% of units sit **nearer the master centre than their own
parent does**, worst case 19 tiles nearer. Penalising the home side directly
barely moved it (35.5% → 33.4%) — because with the facing wrong, "the home side"
was not pointing home. The two are the same fault seen twice.

The nesting itself is sound: zero descendants intrude on the centre past their
own division on the 2,562-person company, so this is about orientation, not
containment.

The fix is to derive a unit's facing from where it was actually placed rather
than from birth order, which is self-correcting at every rung instead of
accumulating. It is circular — you cannot know where a child lands until you
have rotated it — so it wants two passes rather than six.

**☑ Done 2026-10-14 — and the fix above was not the one that worked.** Deriving
the facing from the placement did land, and did what it promised (62% → 45%
misfacing), and **curl-back did not move**. Nor did penalising the home side
(35.5% → 33.4%, re-measured here as 32.1% → 31.3%). The reason, measured: of the
408 units nearer the centre than their parent, only 151 were also *behind* their
parent. The other 257 sat forward of their parent and still ended up nearer the
middle — invisible to any rule phrased relative to a parent, which all three
were.

What worked is a **compass**: every unit is given an absolute bearing from the
shape of the company before any packing happens, so the packer is told which way
is out rather than inferring it. 35% → 7% on the 45-person company, 32% → 13% on
the 1,000-person, 32% → 11% on Northwind; chains dead straight 94% → 99%; layout
no slower, because it replaced a placement pass rather than adding one. It costs
width: +7% and +27% on the two larger companies. `headings` in `territory.ts`,
written up in [HEX-LAYOUT.md](HEX-LAYOUT.md).

---

### ☑ A unit travels to find its gap instead of staying with its family — *Claude, 2026-10-14, found and fixed the same day*

Greg, 2026-10-14, after the spacing fix landed: *"sometimes we're still getting
wild deviations. When moving a medium cluster, occasionally one node will get
flung out, or we'll end up with something that looks like digital spaghetti in
the connection lines."*

**This one is new, and it came in with that same fix.** Making the spacing rule
read from both sides was right, but it left the search unchanged: when a unit
cannot get the clear ground it is owed anywhere near its family, it keeps
looking outward until it finds somewhere that satisfies the gap. So it gets its
room by leaving home. Measured on Digital Tailoring, over eight branches
re-picked within the five-second window, units ending up more than three tiles
from their own parent went **3.0% → 6.5%**, and the 95th percentile went from
**2 tiles to 5**. That is the flung node, and a node five tiles out draws a long
chain, which is the spaghetti.

The answer is already in [MAP-LAWS.md](MAP-LAWS.md) and needs no new decision:
**Law 2 outranks Law 4.** A body stays whole beats one measure of distance, so
when the owed room is not available beside your family you sit tight against
your family and go without it. The previous session made exactly this call for
the tidy path — *"the branch stays against its family and the room comes from
choosing which cell"* — and the drop path has the ranking the wrong way round.

`firstClearCell` in `arrange.ts`: it should prefer a nearer cell that misses the
gap over a further one that meets it, rather than scanning out to `maxRings` for
the first cell that qualifies.

**☑ Done 2026-10-14, and the fix above is not the one that worked.** Preferring
a nearer tight cell is exactly one of four mechanisms tried, and all four slid
along the same line: cohesion bought bunching and spacing bought flinging, with
nothing in between. Applying the law ranking literally — the family price set
above the gap price — gave the *worst* bunching of all, taking units given their
owed room from 115 to 1.

The reason is structural, and it is the same one as the task below: the atlas
grows the ground to make room, while `reflow` has to fit a branch into the hole
that is already there, so for `reflow` the two laws compete for the same cells
and no weighting satisfies both.

What landed instead leaves the search alone and repairs the tail, because Greg
reported *"occasionally **one** node"* — an outlier, not a distribution. A unit
further from its family than its own owed room explains has already lost Law 2
outright, so fetching it back cannot cost anything a higher law ranks. Units lost
by more than a tile: **52 → 0** on the 1,000-person company, **104 → 5** on
Northwind, **16 → 1** on Digital Tailoring. It costs some clear ground on the
largest companies and about 40% more work per pointer move. Measurements, and
the three metrics that measured the wrong thing first, are in
[HEX-LAYOUT.md](HEX-LAYOUT.md).

---

### ☑ Decided and built: a company starts as ragged concentric bands — *Greg, 2026-10-14, decided and built 2026-10-16*

**Decided.** Greg, 2026-10-16, asked to choose between one global set of ring
radii and each branch stacking its own bands outward from its parent, took the
second: **ragged rings.** Built the same day as `lib/map/layout/hex/radial.ts`,
behind a **place** toggle in the lab beside the atlas. The write-up, the
measurements and the four faults found on the way are in
[HEX-LAYOUT.md](HEX-LAYOUT.md) § The radial driver. What follows is the
reasoning as it stood before the decision, kept because it is still the argument.

**Originally raised as:** Recorded so it is not lost and so
nobody rediscovers the reasoning.

Greg, after a day on the placement rules: *"I think we're going to have to put
some more firm rules around what shape a company takes, albeit within the
hexagonal layout paradigm, and albeit to start with before a user manually
rearranges everything. This might see us revert to a more radial arrangement
more like what we have on the main branch — with concentric rings of hexagons
being the initial placements for nodes depending on how far they are from
master-centre."*

Two things from 2026-10-14 bear on it directly:

- **Half of it already exists.** The compass (`headings` in `territory.ts`) now
  gives every unit an absolute bearing worked out from the shape of the company
  before any packing happens. A ring-by-rung scheme is the *other* polar
  coordinate — bearing plus radius. So this reads less like a revert than like
  finishing the idea that landed today, and the packer would become a tie-break
  within a ring rather than the thing that decides position.
- **It would also answer the fault above.** Most of the trouble this week comes
  from the packer searching for somewhere that satisfies competing rules and
  travelling when it cannot. Rings remove the search: your rung says your radius,
  your bearing says your direction, and the only question left is which cell on
  that arc.

What it would cost, and what nobody has measured: a ring has a fixed
circumference, so a wide rung has to either spill or compress, and *"no unit in
any demo company has more than five children"* while a practitioner we spoke to
ran ninety pods. That is the case to test first.

Greg also said, same message: *"Manual rearranging is doing a good job — I like
that."* Whatever is decided, the hand path is working and is not what needs
changing.

---

### ☑ The radial map has no zones and no bubbles — *Claude, from Greg 2026-10-16, built same day*

**Built.** `lib/map/layout/hex/bubbles.ts`, drawn in the lab under everything
else, on both drivers. The two requirements turned out to be one object — a zone
is the ground a branch holds and a bubble is that shape grown by one ring, so
there is one mechanism and the concentric reading emerges rather than being
drawn. Write-up: [HEX-LAYOUT.md](HEX-LAYOUT.md) § Bubbles. Above team level only,
as Greg asked. What it found is the new task below.

**Originally raised as:**

- **The shaded hexagon zones** (requirement 4). A zone is the ground one branch
  holds at one rung — a band crossed with an arc. The driver knows both numbers
  and throws them away after placing; they need to come out in the layout so the
  renderer can shade them.
- **The bubbles** (requirement 6). *"A bubble is taken as the shape of the
  contained node then offset wider by one hexagon spacing."* On a lattice this is
  a dilation by one ring, handed to `outline` in `arrange.ts` — which exists and
  has the test that matters. Cheap; just not done.

`TerritoryLayout.regions` is currently `{ centre, radius }`, a disc, which is the
last surviving relic of the territories-as-discs dead end. It is consumed by
nothing but tests, so it can become a real cell set without breaking a caller.

### ☑ Radial leaves no air between sibling groups — *Claude, 2026-10-16; solved by the spacer rule*

**This is the thing to fix next if the bubbles are to read properly**, and it is
a placement fault rather than a drawing one.

Radial reserves clear ground between a parent and its children and **none at all
between siblings**: the clearance is a radius, and the arcs that hold siblings
apart are a direction, which is not a distance. Measured on the 1,000-person
company, 14 of 15 sibling bubble pairs overlap against the atlas's 2, and 11 of
the 15 sibling nodes sit within two cells of each other. It is Greg's oldest
complaint about this engine — *"the 5s placement feature bunches peer groups
together"* — reached from a new direction.

Two things were tried on the day and are written up in `bubbles.ts` and
[HEX-LAYOUT.md](HEX-LAYOUT.md): applying the shared spacing rule **node to node**,
which barely moved the overlap because a bubble covers a subtree, and cost twenty
whole families — reverted, since Law 2 outranks Law 4; and **clipping the skirt**
off other people's nodes, which took it 14 → 10 and is kept.

**Reserving the footprint as an arc was tried on 2026-10-16 and does not work.**
Greg's suggestion — *"widening a child's arc by what its subtree will need"* —
was built: arcs sized from the footprint, with the band thickening when a rung's
regions do not fit. Swept on Northwind, overlapping sibling bubble pairs run
**27 → 32 → 48 → 56** as the thickening goes 0 → 4 → 8 → 16, while the radius
runs 97 → 255. **Pushing a crowded rung outward makes the overlap worse**,
because the room it buys is room for each subtree to sprawl sideways into its
neighbour. The full sweep and the two other formulations that failed are in
[HEX-LAYOUT.md](HEX-LAYOUT.md) § Separating siblings.

**Solved** — by Greg's spacer rule the same day, which replaced the spacing rule
outright: *"all nodes — human and structural — have a one hexagon space around
them… the only things that can enter that node or human's spacer hexagons are
humans in the same team or humans that are direct children of a structural
node."* Nought breaches on every company, and the panel's *"people sitting next
to somebody from another team"* went from **2,266 of 2,562 to nought**. See
[HEX-LAYOUT.md](HEX-LAYOUT.md) § The spacer rule and Law 4 in
[MAP-LAWS.md](MAP-LAWS.md). The drawing work below still stands and is still
what stops two regions washing the same cells twice.

**Before that, it was treated as a drawing question.** Greg, 2026-10-16: *"two
regions sharing a border may be what an atlas should look like. Try it in how the
boundary is drawn."* Partitioning the one-ring skirt between regions instead of
letting both claim it takes the overlap to **nought on every company under both
drivers**, and drawing a frontier differently from a coastline makes the shared
border read as a border. [HEX-LAYOUT.md](HEX-LAYOUT.md) § It was a drawing
question.

**It is parked rather than done**, because the placement fault is real and
unfixed: sibling regions in radial sit closer together than the atlas's do, and
the drawing now handles that gracefully rather than curing it. Unpark this if the
map ever wants genuine air between regions — a label in the gap, or a region
grabbable by its margin. The three ideas already spent are node-to-node spacing,
footprint-as-arc and thickening; the sweep says thickening makes it worse.

### ☑ Canvas interactions: double-click to make things — *Greg, 2026-10-19/20; built 2026-10-21*

**The brief, in Greg's words:** *"We're going to need some canvas interactions,
rather like Miro — pan, zoom, double-click, right click options. I think the
next model needs a double-click thing, and depending on what you click, you get
options."*

This is the interaction model that **phase two of Grow** will be built on, in
place of the hover-the-ring idea phase one was planned against. It was parked
deliberately — Greg, 2026-10-20: *"no need to code now since we're at usage
limits"* — and picked up on 2026-10-21, when he asked for it to be designed and
built. **Everything below is what was asked for; what was built is at the
bottom.**

#### The gesture, as proposed

| where you double-click | what happens |
| --- | --- |
| **anywhere on empty paper** | a callout offering to create a new node or human |
| **in the grey zone around a node or team** | creates inside that team by default — *"can drag it out later"* |
| **on a node** | other options, still to be settled |

**The grey zone is the strongest part of this**, and it is better than the
hover-a-ring affordance that was planned for phase two. The spacer zone already
*means* "this unit's own space": it is drawn, it is grey, Greg designed it, and
it needs no explaining. Creating there answers *what does this new thing belong
to* **positionally**, rather than by asking — which is the grow study's own
lesson, that a team is discovered from where you act.

**Grey zones nest**, so this needs a tie-break: a person's clear hexagon sits
inside their team's ground, which sits inside the bubble round a group of teams.
The proposal on the table is **innermost wins**.

> ⚠️ **This makes regions mean something, and that is a change of position.**
> Greg, 2026-10-19: *"you'll note regions around teams — these aren't meaningful
> YET."* Creating in a zone makes them meaningful — but for a narrower and
> safer purpose than the one he rejected. He rejected *inferring a relationship
> from where something was dropped*; this is *answering where you deliberately
> chose to create*. A drop is ambiguous, a double-click is a statement of
> intent, and the two readings can hold at the same time without contradiction.

#### Greg's decisions, 2026-10-20

**1. Single click is fine as it is.** Click-and-hold on a node drags it;
click-and-hold on empty space pans. *"Potentially we will later replace this
behaviour: single click-and-drag on any non-occupied zone starts a marquee that
can capture a number of nodes, rather like Miro or Adobe or even a mac desktop.
But not now. Shift+click can gather many nodes too. We'll get to all this
shortly."* So **marquee selection and shift+click multi-select are coming**, and
whatever is built here should not make them harder.

**2. Touch and mouse are allowed to differ.** The app *"would need to know what
it's dealing with: a mouse or a touchscreen."* On a touchscreen **double-tap
stays zoom**, and **pinch stays zoom** — the create gesture does not take them.
Greg accepts the resulting inconsistency between the two, and points at
Apple and Miro for how to handle it. Not a blocker: it can be done in isolation
later.

**3. A press must move before it counts as a drag or a pan.** Agreed, with the
threshold left to whoever builds it. **This also closes a standing fault for
free** — see *"Tapping a node says 'your tile can't fit here right now'"* below.
A tap that never moves would no longer start a drag at all, which is the whole
cause of that dialog.

**4. Undo, properly.** A button in the interface **and** `ctrl+z` / `cmd+z`.
One step back per press, with **about ten steps of history — or five if it turns
out to be heavy**. This matters more than it looks: once a node can be made in
two clicks, people will make them by accident, and today the only undo is tidy's
second press, which throws the whole arrangement away.

**5. Show where it is going.** *"A faint outline or other colour change/pulse
animation should play when the user clicks in a vacant tile."* Double-click is
fast and invisible; without this a node appears and nobody knows why it appeared
*there*.

**6. One behaviour at every scale — no build mode.** Asked whether
double-clicking empty paper should mean something different on a 2,500-person
map than on an empty one: *"as of right now, double click should work
consistently across scales. If a user wants something to happen at that
location, they double click. The gesture will eventually bring up a short menu,
hold the location as highlighted, and potentially provide wider options via a
menu elsewhere."*

So the shape of it is: **short menu at the point of action, the location stays
lit while you choose, and anything longer lives somewhere else.**

#### Still open

- **What the menu offers.** Greg's words were *"a new node or human of any
  level"*. The counter-proposal, not yet answered: hex has no rungs in a user's
  sense — the engine knows a **person** and a **place**, and "level" is just how
  deep something sits. The grow study's menu was **relational** rather than
  ranked — *a person here, a team here, something above this, a separate
  island* — which may read better because it says what the new thing is **to the
  thing you clicked**.
- **What double-clicking a node offers.** Greg: *"some other options TBC."* The
  suggestion on the table is that double-click **describes** it (the commonest
  thing, and what Miro does), with the structural and destructive options behind
  right-click / long-press.
- **"Something above it" is the one creation that cannot be done by pointing.**
  A child goes in a cell; a parent is a rung, not a direction, so it has nowhere
  spatial to live. That is the strongest argument for the node menu existing at
  all, and it is probably what decides its contents.
- **Delete.** Undo covers the accident; nothing yet covers deliberately removing
  something.

#### Answered, 2026-10-21, and built

Greg chose all three recommendations, and delete with them.

- **The menu is relational, not ranked** — *a person in Dune Team*, *a team in
  Dune Team*, *something on its own*. Hex has no rungs in a user's sense, so a
  menu offering "division" would invent a vocabulary the model does not have.
- **A node gets a short menu**, describe first: *describe · someone under ·
  something above · remove*. "Something above" is the one creation that cannot
  be done by pointing, which is what the node menu is for.
- **Remove was built now rather than left to undo.** A node takes its whole
  branch, behind a confirm, and undo brings it back. Once making something
  costs two clicks, a map with no way to unmake one fills up with accidents.
- **The grey decides what a new thing belongs to**, innermost zone first, and a
  person's ground resolves to their team.

What landed: `lib/map/layout/hex/ground.ts` (whose grey is this cell),
`app/lab/hex/menu.ts` (what the menu offers — the companion to `questions.ts`),
the gesture and the two menus in `HexLab.tsx`, the four-pixel movement
threshold, the lit tile, ten-step undo with `⌘z`, and removing a branch. 21 new
tests. Written up in [HEX-LAYOUT.md](HEX-LAYOUT.md) § *Double-click to make
things*.

**Still not done:** right-click, marquee and shift+click multi-select (Greg:
*"we'll get to all this shortly"*), and touch, which is held to a mouse by
`pointerType` and could not be driven on this machine.

---

### ☐ Adding one node re-lays a small company — *Claude, 2026-10-21*

Make a node anywhere on Sparrow Jam and the whole map grows: **2,814 × 2,837
world units becomes 4,452 × 4,098**, and the existing teams move. The thing you
made stays where you put it — Law 0 — but everything else answers to the engine
again, and the result reads as though the map flinched.

**It is not about what you made.** A person and a team give the identical
4,452 × 4,098, so it is the rung schedule reacting to one more unit rather than
anything about people or grouping.

**It is a small-company effect.** The same gesture on Northwind takes 54,679 ×
62,410 to 54,679 × 62,725 — half a percent, invisible. One unit added to a
five-unit company is a fifth of the company, so there is an argument that a
visible re-lay is honest. There is also an argument that a map which jumps when
you add one person is a map people will stop trusting.

**The question for Greg:** should making something leave the rest of the map
where it is until the next tidy? That is a change to the governing rules, which
he asked to leave alone on 2026-10-18 — hence a question rather than a fix.

*For whoever picks it up:* the extent comes from `allocateByTerritory` →
`layoutRadial`'s floor schedule (`floors[d] = floors[d-1] + 1 + max(keep)`),
recomputed from the tree on every change. `npm run hex:zoning` measures the
map; the figures above are from the panel readout on `/lab/hex`.

---

### ⏸ The look of the layers and what shows at each zoom are one job — *Greg, 2026-10-19*

Two things were being tracked separately and Greg has merged them: **making the
corporate layers intelligible to look at**, and **what the map shows at each
zoom level**. His reasoning is that they are linked by the zoom behaviour and
cannot be designed apart — what a division should look like depends on when you
see it, and vice versa.

> *"There's the styling of the whole thing to make the corporate layers more
> intelligible, and then there's the behaviour at each zoom level. Hex has no
> differentiation yet on either aside from a little shading and some minor node
> sizing. I have thoughts on what we should do here but it's tightly integrated
> into what shows at each level."*

He has also asked for a sub-task inside it: **some styling and artistic fun**.

**This is design-first and it is Greg's.** Do not start building it from this
entry — he has thoughts and they come first. Parked here so the scope is
recorded, not so somebody picks it up.

What it would absorb when it starts: the orbital map's semantic layer, three
engines of which the hex map currently uses none — `lib/map/work` (work as a
status-coloured arc, resolving into a dot grid), `lib/map/signal` (the three
data rings: delivery, sprint, team health, drawn only where real source data
exists), and the lower rungs of `lib/map/camera/lod` (people absent at
overview, then a crowd stand-in, then portraits with their own lines). Plus
everything in [LARGE-COMPANY-NAVIGATION.md](LARGE-COMPANY-NAVIGATION.md) that
hex has no answer for: the local detail field, the mark budget and hierarchical
thinning, the edge basket, and focus with a route home.

### ☐ A merged team presses against its neighbours — *Claude, 2026-10-19*

Two teams can now be merged into one on the hex study: you hold one over the
other and pick *"make them one team"*, and everything either of them held ends
up on the survivor. It works, and the map re-lays itself around the bigger team.

**But the bigger team then crowds the one next to it.** On Sparrow Jam, a clean
load has nought cells pressing against a different top-level group; after one
merge it has six. Nothing is obviously broken on screen — this is the map's own
measure of how much elbow room the groups have, and it went from perfect to
slightly short. The likely reason is simply that the survivor is now twice the
size and the ground around it was laid out for one team, not two.

Nobody needs to decide anything. It wants somebody to look at whether the
re-lay is actually giving the merged team the room the spacing rule says it is
owed, or whether a merge quietly squeezes it.

*For whoever picks it up:* reproduce at `/lab/hex?company=small&strata=people`,
radial driver — merge Union Team 1 into Everest Team 2 and watch `scatter.touching`
in the panel. `spacerRule` reads the merged tree, so the rule itself is being
asked the right question; suspect the ring floors in `layoutRadial`, which are
measured per rung and may not have grown with the team.

### ☑ The neck ignores a reduced-motion setting — *Claude, 2026-10-19*

**Done** the same day, in *Grow, on the lattice — phase one*: both motions on
the page stand down under `prefers-reduced-motion`, and the animation clock is
not started at all. Kept here rather than moved, because the entry below still
describes what the rule is.

<details><summary>Original</summary>

Holding one node over another now draws a shape between them that grows over
half a second, so you can see the question arming before you let go. It is the
first thing in the hex study that moves on its own.

Our standing rule is that anything that moves respects the browser's *reduce
motion* setting, for people who find animation uncomfortable or disorienting.
This does not yet. The fix is small — draw the shape at full strength
immediately instead of growing it — and it should happen before any of this
reaches a customer.

*For whoever picks it up:* `app/lab/hex/HexLab.tsx`, the `pulse` clock and the
neck in the painter. Under `prefers-reduced-motion` skip the `requestAnimationFrame`
loop entirely and treat `held` as 1.

</details>

### ☐ Tapping a node says "your tile can't fit here right now" — *Claude, 2026-10-19*

A plain click on a tile — press and release without moving — brings up a panel
saying there is nowhere free nearby, on a map with empty ground all around it.
It is harmless and it looks broken, and it has been there a while; it is not
something this week's work introduced.

The cause is that a press starts a drag, and a drag that never leaves its own
cell never works out where it would land, so the release finds no landing and
refuses. A tap that goes nowhere should do nothing, or select the tile.

**Likely fixed for free by the movement threshold** Greg agreed to on
2026-10-20 — see *Canvas interactions: double-click to make things* above. If a
press has to move before it counts as a drag, a tap never starts one. Worth
doing as part of that rather than on its own, and worth re-checking rather than
assumed.

*For whoever picks it up:* `onPointerDown` leaves `landing`/`anchor` null unless
the five-second re-pickup armed; `onPointerUp` reads that as a refusal. Either
seat the landing at the grabbed cell on pick-up, or treat "never left the cell"
as a tap before the refusal branch.

### ☐ A merge reshuffles every colour on the map — *Claude, 2026-10-19*

Merging two teams changes the colour of the whole company, not just the two
teams involved. The map is still correct, but it looks like far more changed
than did, which is the opposite of what a single deliberate act should feel
like.

Region hues are handed out by position in the branch order, so removing one unit
shifts everybody after it along by one. A hue that followed the unit's own
identity instead would leave the rest of the map alone.

*For whoever picks it up:* `hueById`/`regionOrder` in `app/lab/hex/HexLab.tsx`.
Keying the hue off a stable id rather than an index is the whole change; check
it still spreads the hues apart as well as the index did.

### ☐ A statistic that measures the rule again — *Claude, 2026-10-16*

In the teams view every unit is structural, and the spacer rule forbids two
structural nodes from touching — so the panel's *"families in one piece"* reads
**0 of 130**. Nothing is wrong: a family cannot be one connected patch when its
members may not be adjacent. The number is measuring the instruction.

**This is the third time this engine has done it** — `spacedBy` was added when
*"units not touching their family"* started counting units held apart on purpose,
and the same thing happened to raw adjacency after the tier spacing landed. The
fix is the same shape: ask whether a unit is **where the rule put it**, not
whether it is next to its parent. Worth doing before anybody reads that figure
and thinks the map is broken.

### ☐ Decision: what a bubble does to the spacing rule — *Claude, from Greg 2026-10-16*

**Largely overtaken by the spacer rule**, which gives every node a clear hexagon
and so gives every bubble room to be drawn one cell out. Kept because the tiers
question underneath it is not settled: bubbles are still drawn above team level
only, and nobody has looked at what a bubble round a *team* would do now that
teams have their own clear ring.

**Parked at Greg's instruction** — *"assume bubbles only above team level for now
so the spacing rule doesn't move"* — and recorded so the reasoning is not lost.

**A bubble drawn one cell out from a group needs two clear cells between
siblings**, or two neighbouring bubbles land on the same cell; three if there is
to be visible air between them. Today two sibling teams get exactly one clear
tile, because a team's tier is 1.

So either bubbles exist only above team level, or the minimum gap moves. Law 4
says the gap is **one dial on one rule**, so moving it for bubbles moves it
everywhere — which is precisely the thing that rule exists to prevent becoming a
table of values by rung. This is Greg's call and it is the one place requirement
6 collides with a written law.

**Also worth doing whichever way it goes:** `bubble` already means something else
in the engine — the clear tiles a parent keeps round its own node, in
`territory.ts`. Greg's new meaning is the drawn boundary. Two meanings for one
word in one engine will cost somebody an afternoon. `radial.ts` calls its own
one `clearance`; `territory.ts` has not been renamed.

### ☐ Decision: does the people view's compactness buy its adjacency? — *Claude, 2026-10-16*

On the people view of the largest company, radial is **49× faster** (22ms against
1,071ms), **a third of the radius** (84 against 252), and has **much shorter
chains** (longest 18 against 103) — and is **nine points behind on units touching
their parent** (74.8% against 83.7%) and eight points behind on families in one
piece. In the teams view it wins on every line with nothing to trade.

Nobody should quietly tune that gap away, because it may not be a fault: a child
on the next band is *meant* not to be adjacent, and the study's founding premise
— *"connection lines replaced by adjacency + colour"* — is what adjacency was
for. If chains carry the relationship instead, and they are now one band long and
cannot double back, nine points may be the right price. That is a judgement about
how the map reads, which is Greg's.

### ☐ The master centre sits at the end of a spine, not in the middle — *Claude, 2026-10-16*

Looked at on all three companies with the radial driver, the company's mass lands
to one side of the root rather than around it, so the thing reads as a tail
rather than as a target — which is not what *"offset from master-center"* asks
for. The first band is three to seven units wide on our fixtures, so it is a
sparse fan rather than a ring, and the heaviest child keeps the centre of its
parent's arc all the way down.

Not tuned at, deliberately: it may dissolve once the zones are shaded, and it may
not. Worth measuring before anybody reaches for the arc rule.

### ☑ The hex map is still sized by circular geometry — *Claude, from Greg 2026-10-15, fixed same day*

Greg, 2026-10-15: *"on Hex we should not be observing old laws or codes — almost
at all. Hex should almost be a completely clean build inspired by, but not
copying, the earlier orbital model."* The law numbering that prompted this is
fixed. This is the part underneath it, and it is a real inheritance rather than a
naming slip.

**How big a hexagon cell is — the number every other size on the map is derived
from — is currently worked out from how big a circle of people would be.**
`scene.ts` asks the orbital engine for `seatRingRadius(UNIT_RADIUS,
MAX_SEAT_RINGS - 1) + SEAT_RADIUS`: the radius of a ring of seats orbiting a
disc. It also takes the drawn size of a node (`UNIT_RADIUS`), the size of a
person's dot (`SEAT_RADIUS`), how work marks are arranged round somebody
(`workGridPoints`), and the fan angle for an empty arc (`widestGap`) from the
same place.

This matters because the hex study already decided that circular geometry was
the wrong answer for a hexagon once: `people.ts` exists precisely because the
orbital `placeUnitSeats` *"sits the first six people inside the unit and the rest
on circular rings"*, which is not how people orbit a hex node. That lesson was
applied to where people stand and not to how big anything is.

**Why it has not simply been ripped out.** Emitting an orbital `OrbitalScene` is
a deliberate isolation strategy and it earns its keep: camera, visibility,
signal, work and basket all consume that shape, so the hex study inherited fit,
cull, wheel zoom, the mark budget and the health rings without a line of change.
Breaking the contract costs all of that. The question is not *whether* hex should
emit an `OrbitalScene` — it probably should — but whether it should be **deriving
its own fundamental sizes from circular constants** while doing so.

What to do, in order: give `lib/map/layout/hex/` its own cell-size and node-size
constants derived from the lattice (`people.ts` already has `CLEARANCE =
2/√3`, the hexagon's own inradius ratio); keep emitting `OrbitalScene`; then
check nothing moved. Worth doing **before** any radial rewrite rather than after,
because a ring layout will want to set these numbers itself.

A smaller, related wart: every hex file imports `OrbitalTree` and `UnitNode` from
`layout/model`. That one is **correct** — it is the company's own shape, shared by
every engine, not orbital layout logic. Only the name is now misleading.

**☑ Done 2026-10-15.** `cellRadiusFor` in `people.ts` now derives the cell from
the lattice rule that places the people — the inverse of `ringsBetween` — so the
two formulas are the same formula. `tight` moved by **0.3%**: the circular
version had been landing on very nearly the right answer by accident, which is
why it survived from day one. `roomy` grew **14%**, and that is a correction
rather than a cost — the work reach was being computed for a 9.5-unit orbital
dot when a person on this map is 14.25, so a person's work was under-reserved and
could overlap the neighbouring tile at 1.75× and beyond. A mid-rung cell now
holds 3 rings and 126 seats where it held 2 and 66.

Hex now owns `PERSON_RADIUS` and `NODE_MARK_RADIUS` outright rather than deriving
them from the orbital map's dot. What still crosses the boundary, and why each
one is correct, is written at the import in `scene.ts`: the `OrbitalScene` shape
it hands back (the whole isolation strategy), the work-mark furniture, and one
angle utility. Four tests in `people.test.ts` hold the new rule, including that
doubling every length doubles the answer — no constant has crept in from a
circumference.

---

### ☑ The five-second re-pickup is a second engine for placing things — *Claude, from Greg 2026-10-14, done 2026-10-15*

When you put a tile down and pick the same one up again within five seconds, the
map takes that as *"now tidy this branch"* and re-lays everything beneath it.
Greg, 2026-10-14: *"the 5s placement feature bunches peer groups together — it
does not observe any spacing rules."*

Half of that is now fixed: the rule about how much clear ground a thing is owed
was only ever being asked from one side, so whichever of two neighbours was owed
less decided the gap between them — and a person is owed nothing. Reading it
from both sides took units squeezed inside a re-laid branch from 198 down to 109
against a clean load's 85, and on the 45-person company from 8 to 0.

**The other half is not a spacing rule, it is a second engine.** Three different
things can lay out a branch, and only one of them understands territories. The
atlas measures a child's whole family first and reserves ground for all of it;
the tidy button moves whole branches and measures the clear ground round the
whole body; the five-second path seats one node at a time and reserves nothing
for that node's family. So two sibling teams get placed a respectable distance
apart, and then their people grow into the space between them and interleave.
Measured: sibling nodes end up 2.7 tiles apart against the clean load's 4.6, and
no amount of handing this path better numbers will change that.

The answer is in [MAP-LAWS.md](MAP-LAWS.md)'s own ownership table — *"where does
a unit go: the atlas; nothing else places anything"* — so: have the five-second
gesture call the atlas on the branch, oriented away from home and anchored where
the hand let go, and retire `reflow` from this path. It should finish the
bunching and fix facing inside a re-laid branch at the same time. `arrange.ts`,
`HexLab.tsx`.

**☑ Done 2026-10-15.** The gesture now hands the branch to the atlas
(`relayBranch` + `restBranch` in `territory.ts`) instead of `reflow`. Teams in
one piece went from 73%/40% to **100%** on every company, a person sits exactly
one tile from their team again, and every figure after the gesture matches a
clean load. It is also 250× cheaper per pointer move, because the branch's shape
is worked out once when the gesture arms rather than on every movement of the
hand. Measurements in [HEX-LAYOUT.md](HEX-LAYOUT.md).

`reflow` is still used for a plain drop that cannot keep its silhouette, and for
the clash path. Retiring it entirely is not done.

**Strengthened 2026-10-14 evening, from a night spent failing to avoid it.** Four
separate mechanisms were tried against the flung-node fault above — clamping
travel, grading the gap breach, pricing the laws against each other, gating on
family — and every one traded one of Greg's two complaints for the other. The
frontier is real and it has one cause: **the atlas grows the ground to make
room; `reflow` fits a branch into the hole that is already there.** So inside
`reflow` the two laws compete for the same cells and no weighting satisfies
both. This is no longer a tidiness argument about one owner per question; it is
the only way to get both things Greg has asked for.

---

### ☐ Nothing decides how big a cell should be any more — *Claude, from Greg 2026-10-15*

Not urgent, and worth settling before the layout goes radial.

A cell's size is the number every other size on the map is a share of. Since
2026-10-15 it is worked out properly from the lattice — `cellRadiusFor` in
`people.ts` — as the room needed to stand four hexagonal rings of people round a
node without anybody crossing a boundary.

**Nothing stands people round a node any more.** Greg, the same day: *"when
viewing 'teams' don't show the dots for people — that's a hangover from the orbits
model."* He is right, and the dots have gone. So the cell is now sized to hold
four rings of people nobody draws, which means the rule is honest arithmetic
about something that no longer happens.

It is not currently a bug, and that is worth saying precisely: the layout decides
which *cell* each unit gets, and the cell's size is only the conversion from
cells to world units at the moment of drawing. The camera fits to whatever that
is. So changing it moves no unit relative to any other and changes nothing you
can see — it is a scale, not a shape.

What is open is the question underneath. If a cell only has to hold a node, and a
node is a *share* of its cell, then any size works and there is no rule left at
all — just a chosen number. That is fine, but it should be chosen on purpose and
written down, rather than inherited from a model of people orbiting a node.

Three ways out, and Greg's call which: pick a world scale outright and say so;
re-derive the cell from what is actually drawn in it (the node, the label, and
the gap that tells two peers apart); or keep the people-ring rule because people
come back in some form. `people.ts` is kept intact for the third case.

---

### ☐ Dragging a big branch costs six frames per mouse move — *Claude, 2026-10-14*

Nobody has reported this and it is worth knowing before somebody does. While a
drag is live, the map recomputes where the whole branch would land on **every
movement of the pointer**. On the 1,000-person company, dragging a branch of
1,269 units inside the armed five-second window takes **170ms each time the
pointer moves** — about six frames, so the branch visibly lags the hand. Small
branches are 2ms and fine.

This is long-standing and nothing recent made it worse; it was found while
measuring something else. It matters more than it looks, because the gesture it
spoils is exactly the one Greg has been reporting problems with — some of what
reads as *"the auto-rearrange struggles"* may simply be this. Worth confirming
which before treating them as one fault.

`placeIsland` in `arrange.ts`, called from `onPointerMove` in `HexLab.tsx`. The
likely fix is to recompute only when the target cell changes *and* to bound the
work by the branch, rather than re-laying 1,269 units to answer a question about
where one node goes.

---

### ☐ The drag path still thinks the map is an archipelago — *Claude, from Greg 2026-10-06*

Greg has reported the same shape of problem four times now: moving a family
scatters it, the tidy-up makes it worse rather than better, and groups
*"magnetically align"* to neighbours nobody asked them to join.

**`arrange.ts` and `tidy.ts` were written when the map was an archipelago of
cells. The layout is now nested territories. The drag path is speaking the older
model**, and every one of those symptoms is a consequence. The clearest number:
`neaten` moves **1,775 of 2,957 units** on the atlas against 898 on the
archipelago — it is rearranging more than half the company with rules that
predate territories.

One principle would settle it: **the branch in the hand is rigid, and everything
else yields.** A drop either fits or displaces whole territories; it never
re-lays-out what is being carried. Tidy-up re-runs the territory layout for the
affected subtree rather than gathering cells the old way.

**Reproduced 2026-10-14, and narrower than it looked.** The gesture was
recovered from the 2026-10-06 session transcript — five units Greg grabbed, all
inside Everest Region, whose subtree is 1,258 units, exactly the move count his
saved arrangement held.

The earlier probe missed it for two reasons. A drop into *empty* ground is always
a clean translation, and the map is now spaced so widely that an overlap has to
be aimed for; and "the largest child of the root" is the whole company in these
fixtures, so there was nothing outside it to collide with.

What it actually is: **dropping the node you are holding onto a tile somebody
already has.** 22 of 23 such drops break the branch, against 11 of 450 when the
node lands on free ground. The landing falls back from `parted` to `gathered`,
which re-lays the branch from scratch, and whole families inside it go from
224/248 to about 80. It does not rectify on a second drag because the shape is
already gone.

Two things from the hand-off brief did not survive the measurement, and the
plan should not be run as written:

- **Do not delete `groupOf` from the drop path.** It is the only thing keeping a
  clashing drop whole; removing it turns *every* clashing drop into confetti. It
  wants to become the territory, not to go. (`gapBetween` is the harmful half and
  has gone — `HexLab.tsx`, 2026-10-14.)
- **`neaten` is not the confetti engine.** On the recovered gesture, tidy
  improves cohesion markedly: 86.4% → 91.5% touching family, 403 adrift → 251.
  Stopping it consulting routes is still right on principle (Law 5) but it is
  not a cheap win and not the reported fault.

The remaining work is the real one: **teach the drop path what a territory is**,
so the body that steps aside on a clash is a territory at the rung you grabbed
rather than a flat team id. Law 2 is written as an `it.fails` in
`app/lab/hex/confetti.test.ts`; when it starts failing, the fix has landed.

Repro: `npm run hex:confetti` (Northwind) and the test above (1,000-person).

Do the facing fault above first; it may well change what this one looks like.

---

### ✔ Decided: master-centre's halo is capped at 12 — *Greg, 2026-10-14*

Greg asked for the space around the master centre to be *"HUUUGE"*, and removed
the cap on it: *"the spacing gap cap at 5 is invented. We can revoke it."* The
rule that sets spacing — a gap is a third of the size of what it separates — is
self-limiting and needs no cap. But there is still a guard in the code, at 48
tiles, to stop a pathological company spinning, and **on the two biggest
companies the guard is what decides the gap at the top**, not the rule.

So the top of the map is currently a little tighter than Greg asked for, and the
reason is a number that is not supposed to be a design decision.

What it costs to give him what he asked for, measured on Northwind with people as
units:

| guard | layout time | widest gap | units clipped | curl-back |
| --- | ---: | ---: | ---: | ---: |
| **48 (today)** | **5.7s** | 48 | 6 | 35.0% |
| 96 | 16.0s | 96 | 2 | 32.8% |
| 200 | 25.9s | 119 | **0** | 32.8% |

Past 200 nothing changes — the rule settles at 119 on its own, which is the point
of a share-based gap. Family cohesion is identical at every setting (86.5%).

**The trade is four and a half times the layout time for a map that looks the way
he asked, and slightly less curl-back.** 5.7 seconds already fails the standing
bar of *"an entry-level iPad from five years ago"*, so this is really a question
about the parked performance work below: lazy per-team interiors would likely pay
for the wider guard several times over.

**Greg took the speed.** The halo is capped at 12 (`MAX_HALO` in `territory.ts`),
which is 1.4s instead of 6.6s on Northwind in people view, with identical family
cohesion and slightly better curl-back. The centre is visibly narrower than the
"in extremis" version he asked to see on 2026-10-03, and that is the trade he
made knowingly.

Wanting the full halo *and* the speed is what the lazy per-team interiors work
below is for. When that lands, lift the cap and re-measure — the rule settles at
119 on its own and needs no cap at all once the search is not walking the whole
company.

---

### ☐ The atlas takes four seconds on the largest company — *Claude, 2026-10-04*

With people as the smallest unit, the 2,562-person company takes about four
seconds to lay out in atlas mode. Uncapped spacing takes **233 seconds**, which
is why `MAX_TIER_GAP` has a number in it again.

Two attempts made no difference: starting the ring search outside a node's halo
rather than walking it saved nothing, and enumerating an individual's
family-adjacent cells improved the layout without moving the clock. It is the
search itself at this scale.

Greg has parked this for now — *"I've got a fast enough machine for it not to
matter in these iterations"* — and the lazy-loading work that would also address
it is preserved on the `hex-lazy-interiors` branch. It needs real work rather
than a tweak, and it blocks the atlas becoming the only view, given the bar is
*"an entry-level iPad from five years ago"*.

---

### ☐ The heaviest tests fail on a busy machine, and say nothing useful when they do

Six tests on the big fixtures — the orbital map's placement and overlap checks
on the 2,562-person company — run comfortably inside a second on a quiet
machine, and **fail outright on a busy one**. They have Vitest's default
five-second limit, so what you see is `Test timed out in 5000ms`, which tells
you nothing about what broke. On 2026-10-04 a background macOS file scan took
the load average to 17 and six of them fell over at once; the same six passed
minutes earlier and passed again with the working changes stashed, so there was
never anything wrong with the code.

That is a real cost even though nothing is broken. An agent who sees six red
tests has to stop and prove they are unrelated, and the obvious reading — "I
broke something" — is the wrong one. A human running the suite while a build is
going would reach the same dead end.

The fix is to give the heavy fixtures a timeout that reflects what they actually
do, rather than inheriting a default meant for unit tests. They are measuring
geometry over thousands of units; several seconds is a normal cost, not a
symptom. The ones that fell over are in the orbital map's own test files.

Worth doing before anyone relies on a green suite as a gate.

---

### ☐ Point GitHub at the working branch, not production

GitHub has a "default" branch: the one people land on when they open the
project, and the one new work aims at unless told otherwise. Ours is still
`main`, which is **production** — what customers see.

It should be `next`, where the work actually happens, so nobody aims at
production by accident. It is one setting in the repository's GitHub page.
Greg or Nate.

---

### ☐ One team fills the whole screen, and its neighbours vanish

On the shipped map, zoom in far enough to see a team's people and that team
takes over the screen — everything around it is off the edge. Greg described
it on 2026-09-29 as having to *"zoom to practically Planck lengths"* to see a
person, and losing all the context around them when you do.

**This is not the layout's fault, which is why it needs its own task.** A
team's own dot is about 13 units across. The room it must reserve for its
people and their work boards is about 190 — **fourteen times bigger than the
thing it belongs to** — and that room is reserved at every zoom, including the
whole-company view where none of it is drawn. So the map is roughly an order
of magnitude larger than the overview needs, which is also why crossing a big
company takes so much zooming.

The hex grid study on `lab` confirmed this is independent of how units are
positioned: moving everything onto a grid packed the company 31 times smaller
by area and the imbalance was completely unchanged.

Nothing is being asked of Greg or Nate yet. Someone needs to decide what a
person and a work board should claim at each zoom before this can be built.

*For whoever picks it up:* `SEAT_RING_STEP` (136) and `UNIT_RADIUS` (13.4) in
`lib/map/layout/geometry.ts` are the ratio. `unitOuterExtent` is what the
layouts reserve. `REVEAL_BANDS.people` in `lib/map/camera/lod.ts` is 1.7x, so
people are invisible for almost the whole zoom range the room is held for. The
fix is probably that furniture claims *screen* size within a bounded set rather
than world size — the same move `drawnUnitRadius` already makes for unit discs.
Background and measurements: `docs/HEX-LAYOUT.md` § What it does not fix.

## 🟢 Ready for any agent

Nothing here needs permission beyond the usual house rules.

### ⏸ pnpm would make extra stages nearly free — attempted, stopped

**The problem it solves:** `node_modules` is 572MB, and npm copies it into
every checkout. Two stages side by side costs about 1.2GB; four costs 2.4GB.
pnpm keeps one shared store and hard-links into each project, so the second
checkout would cost almost nothing.

**Why it's parked (2026-09-25):** corepack couldn't fetch pnpm from the
sandbox this agent runs in. That left a broken `pnpm` on the PATH — since
removed, and `npm` is unaffected — but it means the migration can't be
*verified* here: not the install, not the build, not whether Vercel picks it
up. Changing how everything installs, without being able to prove it works,
is the opposite of reducing risk.

**Worth knowing before anyone tries again:** the numbers say this is a
convenience, not a necessity. Your code is 2.0MB. What a user downloads is
2.1MB. What Vercel deploys is 23MB. The 572MB is compilers — 286MB of it is
Next and its Rust compiler, which exist only to produce that 2.1MB. None of it
ships.

So the honest ranking: `npm run stage:clean` after a comparison keeps this at
one checkout and costs nothing. pnpm is worth doing when someone wants three
or four stages live at once, and should be done by a human who can watch a
Vercel deploy succeed afterwards.

*For whoever picks it up:* `corepack enable pnpm` then `pnpm import` to
convert the lockfile; add `packageManager` to package.json; add a `preinstall`
guard so a stray `npm install` can't recreate `package-lock.json`; check
Vercel detects pnpm (it does, from the lockfile) **before** promoting to
`main`.

### ☐ Nothing checks our work automatically

Most software projects have a robot that inspects every change the moment it
arrives: does it compile, do the tests pass, does it build. It's called CI.

**We have none.** There are 568 tests, and they only run when an agent
remembers to run them. The rule that "`main` always builds" holds because
people have been careful, not because anything enforces it.

Adding it means a broken change gets caught in about a minute, automatically,
before it can reach Greg or a customer. It is roughly twenty lines of
configuration and the cheapest safety this repo can buy.

*For whoever picks it up:* a `.github/workflows` job on every push to `next`
and every PR, running `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
A second check — failing when a migration exists on the branch but not in the
deployed schema — would have caught the item at the top of this file, but
needs a read-only Neon connection string in CI, so ask first.

### ☐ Eight long-standing warnings in the map file

A "linter" flags suspicious patterns — not bugs yet, but the kind of thing
that becomes one. There are 8 in the big map file, and they predate this
year's work. The count was deliberately held flat through five refactors so it
couldn't creep up, but nobody has cleared them.

*For whoever picks it up:* `npx eslint components/viz/orbital/OrbitalMap.tsx`
reports 10 problems (8 errors, 2 warnings) — **treat that as the baseline and
do not let it grow.** Mostly `react-hooks/refs` and one
`react-hooks/set-state-in-effect`. Real smells in a 3,600-line component with
54 refs. Best done alongside the runtime extraction below, since several are
the frame loop reaching into render.

## 🔵 Finishing the engine split

The map is now six separable engines ([ENGINES.md](ENGINES.md)). These four
pieces were left behind on purpose, each recorded there with its reason. None
is urgent; all make the next change easier.

### ☐ Camera: deciding *what to look at* still lives in the map

The camera engine knows how to move. Deciding *which* unit to focus and what
to frame around it still sits in the map file, because that decision needs to
know the shape of the company.

*For whoever picks it up:* `enterFocus`, `leaveFocus`, `focusFromBreadcrumb`
and the pending-camera effect. Thin already, and they call the engine for
every number. It is a layout question wearing camera clothes — do it with the
layout work, not on its own.

### ☐ Signal: the hover and detail cards still live in the map

About 310 lines of card UI. Presentational, so they move with the component's
other chrome rather than alone.

*For whoever picks it up:* `OrbitalUnitCard`, `OrbitalHoverCard`, `Meter`.

### ☐ Runtime: the drawing loop

The largest remaining knot — a single function of about 270 lines that runs on
every animation frame and touches 33 different pieces of state.

**It should stay whole.** One loop reading one object is fast; six separate
passes are not, and on a five-year-old iPad that difference is the whole
product. The goal is to give it a tidy object to read, not to break it up.

*For whoever picks it up:* the frame loop, `hitTest`, `buildTargets`.
ENGINES.md § *The knot, stated plainly* has the shape to aim for.

### ☐ About 395 lines of styling at the bottom of the map file

Mechanical. Worth doing *after* the hooks above have taken their UI with them,
so it can be split per engine instead of moved in one lump.

*For whoever picks it up:* the `S` object in `OrbitalMap.tsx`.

---

## 🟣 Bigger pieces

### ⏸ You can rearrange a company, but you can't build one

**This is the biggest piece of unrealised value in the repo.**

The real map lets you move your company around — drag a team somewhere else,
merge two, change who reports to whom. What it *cannot* do is let you create
one: you can't draw a new team into existence and watch the org grow.

That ability does exist — but only in a lab prototype, built with different
drawing technology, so the real map cannot use a line of it. Two
implementations of the same idea that can't talk to each other.

Joining them is what turns "grow your org one node at a time" from a demo into
something a customer can touch.

Parked rather than open because it is about a week of work and wants a
decision first about what "create" should mean on a real company's data.

*For whoever picks it up:* port `app/lab/grow/GrowLab.tsx` (3,320 lines of
SVG) into `lib/map/growth/` as a headless hook the Konva map consumes, then
retire the duplicate. `drop.ts` is the shape its drops should land in. See
ENGINES.md § Growth and [UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md).

### ⏸ Every task on the map is invented

There is no Jira, WorkBoard or tracker connection. Every piece of work shown
on a person is made up by us, and the interface says so on each panel.

Integrations are explicitly later. **This is a marker, not a task** — it is
here so nobody forgets and builds something that quietly assumes the work data
is real.

*For whoever picks it up:* `lib/mock/personTasks.ts` is the only source.

---

## Recently done

*2026-09-24/25 — the six-engine split. Keep this short; the git log is the
real record.*

- ☑ Repo reconciled: 23 branches → 2 (`main`, `next`), every retired branch
  kept as a tag — "Make the docs tell the truth about two branches and one map"
- ☑ Canvas and Radial maps retired; Orbital is the only map — "Retire the two
  alternate maps, so there is one map to make excellent"
- ☑ Six engines named, with a test that enforces the import rule — "Name the
  six engines, and make a test hold the line between them"
- ☑ Camera · Basket · Work · Signal · Growth extracted, then Layout moved —
  "Give every engine its own directory — the split is finished"
- ☑ Four stages (`lab` → `next` → `release` → `main`), the lab pages gated out
  of production, and every seeder stopped from writing to a hosted database —
  "Four stages, so experiments stop leaking into production"
- ☑ The two grow experiments moved out of the front room (they were duplicate
  aliases of pages already under `/lab`, so they were simply deleted)
- ☑ Four stages runnable side by side on their own ports — "Run any two
  stages at once, on their own ports"
- ☑ README rewritten from `create-next-app` boilerplate; `puppeteer-core`,
  a dead screenshot script and five screenshots of a deleted map removed —
  "Clear out what nobody reads, and fix the front door"
