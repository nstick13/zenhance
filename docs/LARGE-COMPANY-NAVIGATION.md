# Large-company navigation — what was built

Built 2026-09-22/23 against the handoff in
[LARGE-COMPANY-NAVIGATION-PROMPT.md](LARGE-COMPANY-NAVIGATION-PROMPT.md)
(Greg, 2026-09-21). That prompt is the contract; this file records what exists,
what it decided where the prompt left room, what is **not** wired, and what was
actually verified. Where this file and the older
[ORBITAL-INTERACTION.md](ORBITAL-INTERACTION.md) disagree, this file is newer.

Everything is on `orbital-large-navigation`, branched from
`integration/orbital-map`. Nothing is committed to `main`.

## The shape of it

Two drawings of a company, chosen deterministically:

| | ring map | local branch geography |
|---|---|---|
| when | the company still reads on one set of rings | when it doesn't, *and* local geography genuinely fits better |
| geometry | radius = reporting depth, angle = parent | children orbit their own parent; branches grow independently |
| dot size | depth | headcount, broad-brush |
| boundary | the dotted family circle | a smoothed outline round occupied territory |

The choice is made by *visual complexity*, not headcount: from the
whole-company view, how far must you zoom before a unit's name can be read?
More than **6×** and the rings have stopped holding their context; local
geography is then used only if it fits the company at least **1.5×** larger.
Measured against a fixed reference screen (1024×768, the iPad in `AGENTS.md`),
never the live window, so resizing a browser can't change the drawing.
Calibration table in `lib/orbital/complexity.ts`.

On the 2,562-person shape: rings need 91× zoom to read; local geography 18×,
and fits 5× larger. Sparrow Jam (1.1×), Digital Tailoring (2.3×) and a
150-person, 5-level company (4×) all stay on rings. A 400-person, 7-level
company fails the ring test but local geography is only 1.15× better, so it
stays on rings too.

## Where the code lives

Pure and tested, in `lib/orbital/`:

| file | what it decides |
|---|---|
| `branches.ts` | local geography: each branch laid out in its own frame; children on one orbit, then drawn inward ("shrink-wrap") |
| `complexity.ts` | which drawing a company gets; `layoutCompany` is the entry point |
| `size.ts` | headcount → compressed proportion → tuned curve → bounded screen area → radius |
| `visibility.ts` | the mark budget and hierarchical thinning; presence fades |
| `detail.ts` | semantic tiers, the local detail field, its lens, and what counts as catchable |
| `envelope.ts` | the territory outline (smooth union → marching squares → Chaikin) |
| `insertion.ts` | where a dragged unit lands and exactly who makes room |
| `basket.ts` | the edge basket's rules (ancestors absorb descendants, etc.) |
| `relationship.ts` | deliberate overlap + dwell → a merge or move proposal, and its words |

`components/viz/orbital/OrbitalMap.tsx` owns camera, drags, basket and dialogs;
`render.ts` paints. No second map engine, no lab: this is the shipped `/org`.

## Refinement — complexity, semantic orbits and magnetic contact (2026-09-23)

Local geography now receives a bounded **radial looseness** value from the
same fixed-viewport zoom-to-read measurement that chooses geography. At zero,
siblings keep one calm circular orbit. As visual complexity rises, each branch
may use more of its own collision-safe inward range; the range itself comes
from branch shape and depth. This is deterministic, local, collision-free and
does not use headcount or the live browser size. Sparrow Jam and Digital
Tailoring still choose rings normally; `?geography=local` remains an
invented-demo-only preview.

A potential parent now has a semantic interaction annulus sized from its own
structural footprint, not from any rendered child link or final child radius.
The current parent is ignored (ordinary movement around it is geography), and
self/descendant/cycle targets are rejected. The strongest eligible annulus and
prospective connection draw during a drag. Release asks **Move [branch] under
[parent]?**; confirmation calls the workspace-scoped `moveOrgUnit`, moves the
complete branch, and atomically removes only the moved root's stale
`orbital_nodes` row. Descendant arrangements remain intact.

Unit contact is deliberately different. The prior grow-study metaball geometry
now paints in Konva: attraction starts before full overlap, gauges stand down,
the carried branch follows on springs, and retreat clears the state. The dwell/
push threshold remains, so a pass cannot arm it. Reduced motion goes straight
to a static kissing state. An armed contact offers **Reparent branch**,
**Merge entire branch** (disabled), and **Cancel**. No merge mutates data.

## The layout engine — four laws (2026-09-23)

Greg, after driving the map at scale: *"Nodes can clash, connection lines can
criss cross, child nodes splay in apparently random directions… moving a node
can change the location of another node even if it's far away. Moving a node
does not always drop it where the mouse leaves it — there's this sort of
randomly elastic behaviour."* The contract for the answer is
[LAYOUT-ENGINE-PROMPT.md](LAYOUT-ENGINE-PROMPT.md); `lib/orbital/__tests__/laws.test.ts`
is where each law is held.

**1. The picture is a pure function** of the company's structure and the
placements people have made. No settling pass, no relaxation, no randomness,
no dependence on the viewport. Proved by re-running and by reversing the input.

**2. A node lands exactly where the hand let go.** `planInsertion` returns the
pointer, unchanged, and `orbital_nodes` gained a nullable `distance` column so
the reload is the same picture. Before this, a drop was pulled onto its
parent's orbit and open ground could not be saved at all — which is what read
as elastic. Where a unit cannot land, the map refuses *before* release rather
than accepting the drop and moving it.

**3. An authored placement is an obstacle.** Nothing but Tidy up moves a
position a person chose; a landing routes around it.

**4. The engine never crosses a connection or overlaps a body.** Measured on
the 2,562-person shape, the 1,000-person shape and the demo: zero and zero.
The laws bind the engine, not the hand — a person may deliberately drop one
node onto another, and that placement stands.

Within the laws, a drag may re-flow its parent branch; it may not touch
anything outside it. In practice the branch travels rigidly and only the
siblings that would be sat on slide along their own orbits.

### Orbits are circles again

Radial looseness (below) packed the company about a third tighter by drawing
each child in along its own ray. It also meant 117 of 134 parents had children
at visibly different distances — Greg read that as orbits being "inconsistent,
some of them quite elliptical" — and it produced the only three link crossings
on the whole company. The shipped map keeps children on one circle per parent
(`ALLOW_RADIAL_LOOSENESS`, one constant, machinery and tests intact). The
company is 34,883 across instead of 21,177; the orbits are legible and
droppable, which is worth more.

A parent's **interaction orbit** — the ring you drop onto to propose a
reporting change — is a true circle centred on the node, a fixed 36 screen
pixels out from its *drawn* edge, the same for a big unit and a small one.

### Two gesture bugs, found by driving it

- Dragging a unit a short way **round its own parent** opened a merge
  proposal: the parent was an eligible magnet target, and it is the one node
  you are bound to pass close to. The parent is now never a merge target.
- The dwell clock ran from first contact while the hand was **still moving**,
  so a slow drag across a unit armed a proposal. A dwell is now a *hold*: the
  clock restarts whenever the hand travels more than a few units. A reparent
  must be held in the same way, so an ordinary drop always just lands.

## Refinement — one size, tighter fans, one territory (2026-09-24)

Built to [ORBITAL-REFINEMENT-PROMPT.md](ORBITAL-REFINEMENT-PROMPT.md), after a
second pass over Northwind. The four laws above still hold and are still
tested.

**Every unit is one size.** Greg: *"the difference in sizing between people and
their parent nodes is still much too great. A team… should be maximum size 2x
the area of a human node. All other nodes between team and master should be the
same size as a team for now."* So a unit's disc is `SEAT_RADIUS · √2`, on both
maps, and it grows only when its own people will not fit within two seat rings
of it — which on these companies is never. The company keeps a larger floor.

Unit size therefore **carries no meaning at present**, neither depth nor
headcount. Two pipelines are switched off rather than deleted, one constant
each: `size.SIZE_BY_HEADCOUNT` and `layout.SIZE_BY_DEPTH`.

Two things followed from it that Greg did not ask for and the map needed:

- The **overview floor** was a table falling with depth (30, 11, 8, 6 … 0.85),
  which was how a rung told itself apart from far away. With one size that
  would have made a deep team a speck beside an identical shallow one, so it
  is one number now, and the company's is larger.
- **Landmark names** were given to the biggest dots. With no biggest dots, the
  whole-company view lost every name. Standing picks them instead — the
  company and three levels below it, 17 names for 411 units — and a per-frame
  declutter keeps the higher-standing name where two would collide.

**Children fan tightly, and vary their distance.** `ALLOW_RADIAL_LOOSENESS` is
back on, with the bound that was missing: a child may only be drawn inward
while its branch still fits the angular slot it was given. That is what makes
variation safe — the three link crossings it used to cause are gone, measured.
Fans narrowed from 200° to 170°, which costs extent (36,024 → 40,252 across on
the 2,562-person shape) and buys a median fan of 87° rather than 102°.

To make variation possible at all, a fan is drawn at `ORBIT_SLACK` wider than
the tightest orbit that fits. At the tightest orbit the wedges exactly fill the
fan, so no child has anywhere to widen into and variation does nothing at all
— which is what the first attempt produced: 0 of 134 parents varied.

**The reparent ring** is 18px from a unit's drawn edge, half what it was, and
it only exists when the *camera* has reached the zoom where unit names read.
The magnifier does not switch it on. Below that, a reporting change is only
reachable by dropping one node onto another and choosing it.

**Double-tap on open canvas leaves focus**, and takes back the detail field
the first tap pinned, so the gesture does one thing.

**The territory stays in one piece.** `structuralEnvelope` samples a fixed
150-step grid across the whole company — about 233 world units per step on
Northwind — while a connector corridor was only ~60 wide. Corridors thinner
than the sampler simply were not found. Corridors are now at least 2.5 steps
wide and bodies at least 1.5, whatever the company's spread. Measured with a
branch dragged eight company-widths out: **32 separate territories before, one
after**.

### What this changed about which map a company gets

Smaller units mean smaller companies, so the zoom-to-read calibration moved.
Re-measured on the reference screen:

| company | ring | local | drawn as |
|---|---|---|---|
| Sparrow Jam, 10 | 0.6× | — | rings |
| Digital Tailoring, 45 | 1.5× | — | rings |
| 150 people, 5 levels | 3.9× | — | rings |
| 400 people, 7 levels | 7.7× | 11.7× | rings |
| 1,000 people, 8 levels | 20.9× | 17.7× | **rings** (was local) |
| 2,562 people, 11 levels | 73.2× | 38.9× | local |
| ~6,000 people, 13 levels | 200.9× | 65.1× | local |

The 1,000-person company now stays on rings: local geography no longer fits it
1.5× better, because tighter fans cost room. Worth watching — it is the shape
closest to the line.

**Performance** (2,562 people / 411 units): layout 32ms, territory outline
35ms, landing plan 0.04ms per pointer move. At ~6,400 people / 1,011 units:
layout 87ms, outline 35ms. Both once per data change.

### Why wedges, not bubbles

A child's orbit is sized by the **angle its branch subtends from the parent**,
not by its whole descendant envelope. Clearing the envelope doubles the reach
at every nested level — ChatGPT's grow study hit exactly that (LAB.md,
2026-09-20: about a trillion units at 30 levels). Wedges make a chain cost its
length, which a test holds (30 levels grows ~3× a 10-level chain, not 2³⁰).

## Decisions this build made

1. **A saved angle means "direction from the parent" in local geography** (it
   stays "direction from the map centre" on rings). One column, `orbital_nodes.angle`,
   has to serve both drawings. On the ring map a child sits outboard of its
   parent, so the two readings put a unit on the same side — measured: median
   7–14° apart, never near a right angle. A ring-era arrangement therefore
   carries over sensibly, and a drop in local geography reloads exactly.
2. **On the ring map a unit stays on its own ring.** Rings *are* reporting
   levels there, so another ring is not a valid place; the map says so and
   points at Break orbits. Radius never proposes a restructure — the old
   "Change this unit's level?" dialog is gone.
3. **A blank tap pins the local detail field** and clears the selection. It no
   longer leaves Focus (which supersedes ORBITAL-INTERACTION §2). Focus is left
   by its breadcrumb, the new ✕ beside it, or Esc. Esc steps back one thing at a
   time: dialog → field → selection → focus.
4. **Dots share the room between them in proportion to what each wants**, and a
   neighbour only claims room in proportion to how present it is. So a division
   whose teams are thinned away shows its weight, two big neighbours both stay
   prominent, and no two present dots can overlap (proof and tests in
   `lod.neighbourAwareRadius`).
5. **A person only re-settles round their own team on the map.** Moving them to
   another team is a deliberate drop onto it, and asks first.

## Not wired, deliberately

- **Merging.** Target detection, the gesture and the confirmation exist. The
  dialog's **Reparent branch** action is live; **Merge entire branch** is
  present but **disabled**, because
  what happens to both units' own people and who leads the merged unit is
  undecided. Nothing about a merge touches data.
- **Review branch** in the merge dialog: deferred by the prompt. Not built.
- **A person move changes the map only.** Confirming writes the same map-level
  row the map has always written (`orbital_nodes`), not the assignment. Whether
  a confirmed move should edit `assignments` is Greg's call.
- ~~**Free placements aren't saved.**~~ **Superseded 2026-09-23 by Law 2.**
  `orbital_nodes` gained one nullable `distance` column, so a placement is a
  full position round its parent and any landing reloads exactly. Adding the
  column is a schema change that reaches production when this merges; the
  column is nullable and old rows keep their old meaning. Placements made with
  **snaps off** are still deliberately not saved — that mode means nothing by
  design.

## Verified, and not

**Verified by pure tests** (413 across the suite after this refinement):
layout stability and locality, non-overlap at 2,562 people, chain growth,
envelope containment, activation determinism and calibration, hierarchical
thinning and budget, monotonic/bounded dot area, dot non-overlap at six zooms,
local effective detail and the one-tier bound, lens invertibility, saved-angle
round trips, insertion locality and preview-equals-commit, basket rules,
dwell/push arming, and that a hidden unit is never painted.

The refinement adds proofs for monotonic bounded radial looseness across
representative visual-complexity fixtures; circular regularity at zero;
determinism, locality, bounds and non-overlap at multiple looseness values;
interaction-orbit independence from rendered connection length; valid and
invalid reparent targeting; pre-overlap magnetic state; retreat and quick-pass
safety; the metaball bridge; and immediate reduced-motion arrival.

**Verified in a browser** on Sparrow Jam and Digital Tailoring (desktop
1280×800 and a 375×812 phone): tap-to-pin field with detail lifting a tier;
node tap promoting a unit and its route without moving the camera; Focus,
breadcrumb, ✕ and blank-tap-keeps-focus; drag insertion with neighbours making
room and the saved angles matching (Oversight stepped to exactly 50° clearance);
off-ring refusal and its notice; open-ground placement labelled session-only;
basket carry, placeholder, drag-out, landing, Return; merge proposal on hold
and *not* on a quick pass; person-move proposal, confirmation, and that
`assignments` stayed unchanged.

**Not verified:** the large-company path in a running app — no large workspace
exists and the prompt forbids recreating one. It is covered by pure tests and by
rendered snapshots (`docs/` has none; they were sent to Greg). A dev-only
`?geography=local` on an invented demo company exercises the same code paths in
the real renderer, and was used for that. Also unverified: `prefers-reduced-motion`
in a browser (the code path is unit-tested: springs arrive instantly, fades
shorten, reveal ripple is skipped), real touch/pinch on a real device, and
behaviour on an actual five-year-old iPad.

**Performance** (this laptop, 2,562 people / 433 units): layout 28ms once per
data change, territory outline 25ms, visibility budget 0.18ms per pass (at most
every 80ms), landing plan 0.04ms per pointer move. At ~6,000 people / 1,025
units: layout 67ms, outline 25ms. Nothing per-frame got heavier except a
constant-time pass over visible marks.

Re-measured 2026-09-23 with circular orbits (2,562 people / 411 units):
whole-company layout median **23.6ms** (18.4–45.8 over seven timed runs after
warm-up), territory outline 28ms, landing plan 0.089ms per pointer move. At
~6,400 people / 1,011 units: layout 64ms, outline 31ms, landing plan 0.107ms.
Faster than the loose layout, because circular orbits skip the inward search
entirely.

Browser QA after the refinement covered Sparrow Jam, Digital Tailoring and the
forced local preview at desktop and 375×812. Both real demo views stayed on
rings; forced-local Sparrow stayed circular. Mouse and tap-equivalent selection
worked; semantic-orbit drops opened the correct confirmation on desktop and
touch-size; cancelling left reporting structure unchanged; a quick node pass
did not arm. Browser console errors: none. The OS reduced-motion browser path
was not toggled because that would change a user system setting; the immediate
motion, magnetic joined-state and reveal-skip paths are pure-tested. A sustained
held pointer was not available through the browser harness, so the armed
metaball modal is pure/render-tested rather than browser-observed.

## Known rough edges

- A landmark name can run under a neighbouring dot at overview; names have no
  collision avoidance yet.
- Saved ring-era placements can put two units close enough to overlap in local
  geography. The insertion planner makes room on a *drop*; it doesn't tidy an
  arrangement on load. Tidy up clears them.
- In ring-map Focus, a saved angle is measured from the focused unit while the
  master view measures from the company, so an arrangement saved while focused
  moves when you leave focus. Pre-existing; not touched here.
