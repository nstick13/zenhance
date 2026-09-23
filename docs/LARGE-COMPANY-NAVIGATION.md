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
  dialog's **Merge entire branch** button is present but **disabled**, because
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

**Verified by pure tests** (402 across the suite, 248 in `lib/orbital`):
layout stability and locality, non-overlap at 2,562 people, chain growth,
envelope containment, activation determinism and calibration, hierarchical
thinning and budget, monotonic/bounded dot area, dot non-overlap at six zooms,
local effective detail and the one-tier bound, lens invertibility, saved-angle
round trips, insertion locality and preview-equals-commit, basket rules,
dwell/push arming, and that a hidden unit is never painted.

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

## Known rough edges

- A landmark name can run under a neighbouring dot at overview; names have no
  collision avoidance yet.
- Saved ring-era placements can put two units close enough to overlap in local
  geography. The insertion planner makes room on a *drop*; it doesn't tidy an
  arrangement on load. Tidy up clears them.
- In ring-map Focus, a saved angle is measured from the focused unit while the
  master view measures from the company, so an arrangement saved while focused
  moves when you leave focus. Pre-existing; not touched here.
