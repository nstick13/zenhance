# The layout engine — build prompt

Prepared with Greg, 2026-09-23, after looking at `?geography=local` together.
This is the contract for the next story. Where it disagrees with any existing
doc, this wins; where it is silent, `AGENTS.md` and
[LARGE-COMPANY-NAVIGATION.md](LARGE-COMPANY-NAVIGATION.md) apply.

## What is wrong today

Greg's words, from using the map:

> I don't know how the layout engine works — and that's likely because I
> haven't defined one properly. Nodes can clash/go on top of each other,
> connection lines can criss cross, and child nodes can splay in apparently
> random directions. Furthermore, moving one node can change the location of
> another node even if it's far away. Moving a node does not always drop it
> where the mouse leaves it — there's this sort of randomly elastic behaviour.

And, separately, that parent orbits are inconsistent — "some of them quite
elliptical, or having the centre of the orbit not on the node".

So: **the map's geometry is not trustworthy, and the hand is not believed.**
Everything else in the feature rests on this, which is why it is its own story
and why nothing else is in scope.

## What you are building

One layout engine with four properties, stated as laws. A law is not a goal:
if the code cannot satisfy it, the law does not bend — the design does, and
you bring the conflict to Greg.

**Law 1 — The picture is a pure function.** A company's layout is computed from
its structure and its saved placements alone. Identical inputs give byte-identical
positions, on any machine, at any zoom, in any order. No physics, no settling
pass, no relaxation-until-stable, no iteration count that changes the answer, no
randomness, no dependence on the viewport or on what is currently visible.

*This does not mean regimented.* The existing radial looseness is itself a pure
function of the company's own shape, and the organic, uneven look Greg likes is
to be kept. What is banned is the settling, not the irregularity.

**Law 2 — A node lands exactly where the hand let go.** The dropped node's final
position is the pointer's position at release, unchanged. It is never pushed,
pulled, snapped, eased or corrected afterwards. What was previewed under the
pointer before release is what is committed after it, and what comes back on
reload. If a drop cannot be honoured at all, refuse it plainly before release —
do not accept it and then move it.

**Law 3 — Authored placements are obstacles, not suggestions.** A position a
person chose is never silently moved, by a re-flow or by anything else. The
engine routes around it. Only an explicit Tidy up clears authored placements.
A re-flow may move only nodes nobody has placed by hand.

**Law 4 — Connections never cross, and bodies never overlap.** Not "rarely":
never, by construction, within a company. Prove it with a test over every
fixture, not by inspection. If two branches cannot both be drawn without a
crossing, that is a finding to bring to Greg, with the case that caused it.

**The laws bind the engine, not the hand.** Law 4 governs what the engine
produces on its own. A person may deliberately drop a node somewhere that
overlaps or crosses, and that placement stands (Law 3) — the map is theirs to
arrange badly. What must never happen is the *engine* producing a clash nobody
asked for.

Within those laws, a drag may re-flow the dragged node's **whole parent branch**
to pack it well. It may not touch anything outside that branch — no node in
another branch moves by a pixel, for any reason.

## Parent orbits

Every unit offers one interaction orbit, and it must read as a plain circle
drawn round that unit:

- A true circle, never an ellipse, in every coordinate frame and at every zoom.
- Centred exactly on the node it belongs to.
- At **half its present distance** from the node's edge — Greg's call, from
  looking at it. The distance is measured from the drawn edge of the node, so a
  big node and a small node both get the same visible gap.
- The same gap for every unit on the map. If a unit's own footprint currently
  changes that gap, that is the inconsistency Greg is seeing; remove the cause.

## Verification

Cheap checks first: `npx tsc --noEmit`, then Vitest.

**Pure tests are the proof of the laws**, and each law gets tests that would
fail if it were broken:

- determinism across repeated runs, shuffled input order and both geographies;
- zero body overlaps and zero link crossings on every fixture, including the
  2,562-person `lib/orbital/__tests__/fixtures/deepOrg.ts` shape;
- a drag's effect confined to its parent branch — every node outside it
  identical before and after, to the bit;
- drop position equals release position, and equals what reloads;
- an authored placement unmoved by a re-flow that would otherwise want its spot;
- orbit radius a fixed offset from the drawn node edge, and circular.

**Then look at it**, in a browser, on all three companies at desktop and touch
sizes. Drag things. Say exactly what you exercised and what you did not. A
screenshot is not proof of an interaction.

## Northwind comes first

You cannot verify a large-company layout without a large company, and the map
has not been driven at scale in a running app since the shape was retired on
2026-09-20.

Recreate **Northwind** as a third demo company — invented people only — seeded
into the **local development database only**, selectable alongside Digital
Tailoring and Sparrow Jam. Use the `deepOrg.ts` shape so the pure tests and the
running app describe the same company. The production database is not touched
and the production seeding path does not gain it. Record in `docs/` why it is
back, so the 20 Sep retirement note is not read as still current.

Do this first, then build the engine against it.

## Not in this story

These are Greg's, already reported, and deliberately deferred so this story
stays about geometry:

- the merge magnet beginning too close (it should start 50% further out);
- unit dots being far too large (all non-human nodes to become one size, about
  twice a person's area, with the company keeping a larger floor);
- people carrying two progress bars (restore the half-torus, drop the completion
  rings and the pill; the torus dissolves into the dot arrangement, which is
  already right);
- the merge animation's jitter on approach.

## Standing rules

- Work in the production orbital map (`components/viz/orbital/*`, `lib/orbital/*`).
  No lab, no second engine.
- Audit before proposing new machinery. Much of what is needed exists.
- Read the installed Next.js guides before any Next-specific change.
- Sparrow Jam and Digital Tailoring must come out of this unchanged. Check both.
- It must run on a five-year-old entry iPad and a ten-year-old Lenovo: no
  per-frame React state, no global relayout during pointer movement.
- Touch is first class. Respect `prefers-reduced-motion`.
- Demo fixtures are invented people only. Tenant boundaries hold. Production
  data is not touched.
- Do not commit or push unless Greg asks.

Before editing, report the current-state audit, the first reversible slice, and
any genuine conflict between these laws and the live code. Then proceed.
