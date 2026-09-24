# Orbital refinement — build prompt

Prepared with Greg, 2026-09-24, from a second pass over Northwind, Sparrow Jam
and Digital Tailoring. This is the contract for the next story. It sits on top
of [LAYOUT-ENGINE-PROMPT.md](LAYOUT-ENGINE-PROMPT.md), whose **four laws still
hold** and are not up for renegotiation here:

1. the picture is a pure function of structure and saved placements;
2. a node lands exactly where the hand let go, and reloads there;
3. an authored placement is an obstacle, never a suggestion;
4. the engine never crosses a connection or overlaps a body.

Every change below must leave `lib/orbital/__tests__/laws.test.ts` passing. If
one of them cannot be made without breaking a law, stop and bring Greg the
conflict rather than weakening the law.

## 1. Children fan tightly, away from the grandparent

Greg: *"I'd like child nodes to distribute themselves on the opposite side of
their parent node to their grandparent, make use of variable connection line
lengths where needed, and by default try to fan out more tightly, rather than
splaying in such a way that they are equidistantly distributed around the
parent node. Some variance is needed since this needs to work spatially."*

**This reverses yesterday's circular-orbit decision, deliberately.** That
decision was made from Greg's complaint that orbits looked *"inconsistent,
some of them quite elliptical"* — which he has now clarified was about the
**reparent interaction ring** (§2), not about where children sit. So:

- Turn radial variation back on (`ALLOW_RADIAL_LOOSENESS`; the machinery and
  its tests are intact). A child may sit closer in along its own ray when its
  branch allows, so a small team does not hang off the same long stem as a
  huge sibling.
- **Bound the variation by the branch's own angular wedge.** This is the part
  that was missing: pulling a child inward widens the angle its branch
  subtends from the parent, and when that exceeds its allocated wedge, two
  branches can overlap in angle and their connections cross. Measured on the
  2,562-person shape, that produced exactly three crossings. Clamp the inward
  pull so the branch still fits inside its wedge, and Law 4 survives.
- Fan **tightly** by default. Children gather on the side away from the
  grandparent and are not spread evenly round the parent. The company's own
  children are the exception: it has no grandparent, so they may use the whole
  circle.
- Keep it deterministic. No settling, no randomness (Law 1).

## 2. The reparent ring, and when it exists at all

Greg: *"the indicated drop zone seems to be inconsistent — it's too easy to
inadvertently re-parent. The re-parent interaction area should be consistent
and hug the parent node more tightly; its size should be a fixed distance from
its node, and about half its current size."*

- A fixed distance from the node's **drawn edge**, the same screen distance for
  every unit, **half its current value** (36px → 18px). It is already a true
  circle centred on the node; keep it so.
- **It only exists when unit names are readable from the camera itself.**
  Below that zoom, dragging is pure geography and no reparent ring is drawn or
  hit. The magnifier does not count: a pinned detail field lifting local
  detail must not switch reparenting on. Read the camera scale, not the
  effective detail.
- Where the ring is off, reparenting is still reachable the deliberate way:
  drag one node **on top of** another, hold, and choose in the dialog.
- The dwell rules from yesterday stand: a ring drop only asks if the hand held
  still on it, and a unit's own parent is never a target.

## 3. Double-tap the canvas to leave focus

With a focus on a node, a double-click or double-tap on open canvas clears it.
Single tap keeps its present meaning (pin the detail field, clear selection),
so the two must not fight: a double-tap must not leave a pinned field behind
from its own first tap.

## 4. Nodes are small, and the same size

Greg: *"the difference in sizing between people and their parent nodes is still
much too great. A team (the direct parent of a human node) should be maximum
size 2x the area of a human node. All other nodes between team and master
should be the same size as a team for now."*

- A person is the reference (`SEAT_RADIUS`). A team's disc is **at most twice a
  person's area**, and every unit between team and the company draws at that
  same size. The company keeps its larger floor so the map still has an anchor.
- **A team's disc grows only when it has to** — when its own people cannot be
  seated round a disc that small — and then only by as much as seating forces.
  Greg's choice; state in the code what "has to" means.
- This makes headcount-based sizing inert. Switch it off behind one constant
  rather than deleting it (`lib/orbital/size.ts` and its tests stay), and say
  in the doc that unit size currently carries no meaning. Greg: *"I don't have
  a concrete position on node sizing just yet."*
- Sizes feed footprints, which feed the layout, so re-measure extent,
  zoom-to-read and which companies choose which geography afterwards. Sparrow
  Jam and Digital Tailoring must still choose rings.

## 5. The territory outline must stay in one piece

Greg: *"The company boundary shrink wrap breaks when the connection line
becomes too long. It should remain contiguous."*

Diagnosed: `structuralEnvelope` samples a fixed 150-step grid across the whole
company — about 233 world units per step on Northwind — while a connector
corridor is only `pad` (~60 units) wide. A corridor thinner than the sampler
can see simply is not found, so the territory splits at long links.

Fix it so a corridor is always resolvable, whatever the company's size, and
hold it with a test: for Northwind and for a fixture with a deliberately long
link, the territory is **one** connected outline, not several.

## Out of this tranche

- **The half-torus (Greg's item 4).** It still exists and still paints; what is
  needed is retiring the rounded-rectangle progress painter and settling which
  zoom band each belongs to. Its own job.
- **Faked health data for Northwind (Greg's item 1).** Northwind became a
  sample-work company only in yesterday's commit, which Greg has not seen
  running — it already draws delivery, sprint and health rings. He will look
  before anything is invented.

## Verification

Cheap checks first: `npx tsc --noEmit`, then Vitest.

The laws test must still pass, and gets two additions: variation stays inside
its wedge (zero crossings with variation **on**), and the territory is one
connected outline.

Then look at it. Northwind, Sparrow Jam and Digital Tailoring, desktop and
touch sizes. Sparrow Jam and Digital Tailoring must come out unchanged except
for the new node sizes. Say exactly what was exercised and what was not; a
screenshot is not proof of an interaction.

## Standing rules

- Production orbital map only (`components/viz/orbital/*`, `lib/orbital/*`).
- Audit before adding machinery; most of this is tuning what exists.
- Read the installed Next.js guides before any Next-specific change.
- Runs on a five-year-old iPad and a ten-year-old Lenovo: no per-frame React
  state, no global relayout during pointer movement.
- Touch is first class; respect `prefers-reduced-motion`.
- Invented demo people only; tenant boundaries hold; production data untouched.
- Do not commit or push unless Greg asks.

Before editing, report the audit, the first reversible slice, and any genuine
conflict with the laws. Then proceed.
