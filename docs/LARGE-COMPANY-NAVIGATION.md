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
- **Free placements aren't saved.** `orbital_nodes` can hold one angle per
  unit, so a spot off a unit's own orbit — including a basket drop into open
  ground — lasts for the session, and the map says so. Saving those needs two
  nullable columns (x, y), which is a production database change.

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

Re-run after the refinement on the fixture's approximate 2,562-person target
(it emitted 2,721 people / 433 units): median whole-company layout **28.1ms**
over ten timed runs after warm-up (23.1–34.7ms), ring zoom-to-read 91.3×,
local zoom-to-read 20.5×, radial looseness 1.0, and zero footprint overlaps.

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
