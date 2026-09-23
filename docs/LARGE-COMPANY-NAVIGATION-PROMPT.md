# Large-company navigation — next-session build prompt

> Prepared with Greg on 2026-09-21. This is a copy/paste handoff prompt for a
> fresh context window. It consolidates the product decisions; it is not proof
> that any item below has been implemented.

## Prompt

We are beginning the **large-company geography, pan/zoom and local-detail**
story for Zenhance's production orbital map.

Take ownership of this feature from current-state audit through a verified,
coherent implementation. Work in staged, reversible slices rather than one
large rewrite, but do not stop at a plan if a safe first slice can be built and
verified. Do not commit or push unless I ask.

### Start correctly

1. Read `AGENTS.md`, then `docs/CODEMAP.md` and the scale finding headed
   **"Orbital: optical zoom can't hold context at 12 rungs"** in
   `docs/ROADMAP.md`.
2. Read this prompt in full, plus `docs/ORBITAL-INTERACTION.md`. Where the older
   interaction brief conflicts with this prompt, this prompt is the newer
   decision.
3. Fetch before starting, inspect the current branch/status and preserve every
   unfamiliar or uncommitted change. This work may resume on a branch that has
   moved since the prompt was written.
4. Inspect only the relevant regions identified by the code map. The likely
   owners are `components/viz/orbital/OrbitalMap.tsx`,
   `components/viz/orbital/render.ts`, and the pure modules under
   `lib/orbital/` (`layout`, `lod`, `focus`, `snap`, `position`, `forest`, and
   their tests). Read the relevant installed Next.js guide before changing any
   Next-specific code.
5. Audit what already exists before proposing new machinery. As of 2026-09-21,
   the production map already has pointer-anchored wheel zoom, pan, continuous
   semantic LOD, focus/re-rooting with breadcrumbs, route highlighting,
   branch-carrying drag, saved arrangement overrides, local spring motion, and
   a live neighbour-displacement/landing preview. Preserve and adapt those
   strengths. Do not rebuild them in a lab or introduce a second map engine.

### Product outcome

Make a large company feel like a navigable geographical world rather than a
giant target of global concentric rings.

The normal view is **local and relevant to the current user**, not necessarily
a fit of the entire company. A COO may choose the whole-company overview, but
even that view is a point of departure. If the product cannot yet identify the
user's organisational location or role, use a deterministic, meaningful local
fallback and do not invent role or permission data.

The user must be able to:

- understand the major territory of a large company without drawing every
  person or small team;
- pan and zoom with the familiarity of a map product;
- reveal local structure and detail without losing the surrounding company;
- select a visible unit without the camera unexpectedly diving many levels;
- rearrange geography with an exact preview of what will move;
- carry one or more branches across a very large map using an edge basket;
- distinguish a harmless geographic move from a relationship-changing drop.

### 1. Geography grows from the company

For companies that exceed the map's visual-complexity capacity, stop forcing
every depth onto one set of company-wide concentric rings.

- Preserve an orbital grammar **locally**: children gather in an arc, orbit or
  fan around their own parent.
- Let branches grow independently. A shallow branch may remain compact; a
  deeply nested branch may extend like a chain.
- Keep the result deterministic and spatially stable. Users need to remember
  where things are between visits. A local change must not repack distant,
  unrelated branches.
- Retain visible parent/child routes so depth remains understandable without a
  global `distance from company centre = reporting level` rule.
- Preserve small-company behaviour where it still works. Do not make Sparrow
  Jam worse in order to support a twelve-rung company.
- Choose large-company behaviour from actual visual complexity—fit scale,
  landmark legibility, occupied extent and/or detail budget—not a naked
  employee-count constant. Calibrate it against representative shapes and
  make the transition deterministic.
- Existing saved angles/positions are user-authored geography. Define and test
  how they map into the new local geometry; never silently discard them.

The wide-view boundary becomes a quiet, smoothed offset around occupied
**structural** territory. It is not a data region and must not imply ownership
or health. People, work dots, hover effects and an active drag must not make the
boundary continually breathe. Use the full settled structural geometry for
the world extent and fit/minimum-zoom calculation even when some nodes are not
currently painted.

### 2. One camera, local semantic detail

Do not create concurrent independent cameras. Keep one geographic camera and
layer a local semantic-detail field over it.

- Wheel and pinch always zoom the geographic camera around the user's gesture
  location. Background drag pans. These meanings must not change when a lens
  is active.
- Treat the global camera scale as a **base zoom index**. A pinned local field
  may raise effective semantic detail by a bounded amount—normally about one
  tier—without changing the base camera.
- A blank-field tap clears ordinary node selection and moves/pins the local
  detail field to that location. It should gently reveal what is there, not
  recenter or dive into the hierarchy.
- Hover may provide a restrained preview on pointer devices, but meaningful
  operation must not depend on hover. Tap is first-class.
- Clicking a clearly visible, interactable unit brings that unit, its immediate
  children and its route through its parents into prominence relative to the
  starting zoom. It does **not** automatically zoom or recenter the camera.
- Existing explicit Focus/double-tap behaviour may provide the deliberate
  deeper step. Preserve its breadcrumb and a clear way out.
- A maximum-overview tap must not jump straight to team/person/work detail.
  Territory may become structure; structure may become teams; teams may become
  people. The user controls further descent.
- Nodes that are visually absent or below the interactable-size threshold must
  not retain invisible hit targets. A tap there belongs to the background
  field; after local detail makes a node visible, it may be selected.
- Local expansion may gently displace nearby marks to prevent overlap, with
  influence decaying smoothly with distance. It must not rewrite or persist
  master geography, and distant regions must remain stationary.

Centralise the effective-detail calculation so paint, labels, culling and hit
testing cannot disagree about what exists. Prefer pure, tested functions over
scattered component thresholds.

### 3. Progressive visibility and dot sizing

At maximum overview, do **not** draw every unit, person and team merely to say
that they exist.

- Apply a viewport/detail budget with hierarchical thinning. Spend it first on
  the company/current focus, selected and searched routes, major branches,
  units near the local field, then smaller surrounding units as room permits.
- Normally do not reveal a descendant before the structural route to it. Search
  or explicit focus may override ordinary thinning, but must expose the route.
- People and work remain hidden until their semantic tiers. Small teams may
  also be absent at overview.
- Marks emerge, grow and acquire detail continuously; avoid threshold popping
  or a simultaneous "popcorn" reveal across the map.
- Hidden units still contribute to settled geography and the overview extent.

Dot size carries only a **broad-brush** sense of descendant headcount. People
are poor at accurate bubble-size comparison; never make exact interpretation
depend on area.

Use an explicit, product-tuned size-index pipeline:

`descendant headcount -> compressed proportion -> tuned size index -> bounded screen area -> radius`

Interpolate **area**, then derive radius. The curve may be aggressively edited
and need not be mathematically proportional. The company/master dot receives a
prominence floor. Bigger generally means more people below, but similarly sized
dots only imply a similar order of magnitude. Exact counts belong in labels or
tap/hover detail. Keep hard minimum and maximum screen sizes and test monotonic,
bounded behaviour.

### 4. Predictable geographic drag

Dragging a unit edits map geography only. It must never silently change the
organisation of record.

- Treat the dragged unit and its complete descendant branch as one carried
  object.
- Before release, open an insertion gap and ease only the smallest relevant
  local neighbour group into the exact positions they would occupy after the
  drop. The result visible before release must be the result committed after
  release.
- Moving through valid positions carries the gap with the pointer. Leaving the
  valid area restores the preview.
- Do not move distant or unrelated branches.
- A change of radius/ring by itself remains geography. Do not infer reparenting
  or open a restructure proposal merely from where on the map a unit is placed.
- Keep reduced-motion behaviour causally clear without relying on animation.

Separate insertion and relationship gestures:

- **Approach:** no reaction yet.
- **Insertion range:** a gap opens between units; this is geographic placement.
- **Direct overlap:** one prospective relationship/merge target holds still and
  gains a distinct treatment.
- **Deliberate dwell or push:** the treatment completes, making release open a
  relationship confirmation.
- **Release before the threshold:** no merge or relationship change.

Use a much stronger and semantically distinct merge treatment than the normal
landing preview. Do not let merely passing over a node trigger it.

### 5. Edge basket for long-distance movement

Add a fixed **screen-space basket/tray** at the viewport edge for carrying
branches across a large map.

- The drop region becomes available when an eligible node is dragged toward
  it. Use a right-edge tray on suitable desktop layouts and a bottom tray above
  the OS safe/gesture area on touch layouts. It may collapse when empty.
- Dropping a unit into the basket stores a pending carry; it does not persist a
  position or relationship change.
- Leave the source unit visible at its original geography as a clearly marked
  placeholder. Use desaturation, an outline or a carry badge rather than
  replacing meaningful health/status colour. It cannot be dragged into the
  basket twice; tapping it may reveal the matching basket entry.
- Support multiple unrelated basket entries with compact names/types and branch
  counts. While the basket is non-empty, the user may pan, zoom, focus and move
  the local field normally.
- An ancestor entry already carries every descendant. Prevent separately
  basketting those descendants. If descendants are basketed first and an
  ancestor is added later, absorb them into the ancestor entry and explain
  briefly that they are included with that branch.
- Dragging an entry out re-enters the ordinary landing preview. Dropping into
  ordinary space commits geographic placement. A cancelled or invalid drop
  returns the entry to the basket, not the origin.
- Provide **Return** per entry and **Return all**. These restore ordinary source
  appearance without changing geography or data.
- Basket state is pending UI state, not organisational data. Do not persist it
  as a completed move.
- Keep short-range edge-pan where it does not conflict with the basket region;
  do not require obscure two-finger navigation while one finger holds a node.

### 6. Relationship-changing drops and merge boundary

The navigation story must make room for relationship changes without inventing
unfinished data semantics.

- A person dropped deliberately onto another team, or a unit deliberately
  merged into another unit, is a relationship proposal—not ordinary geography.
  It requires an explicit confirmation before changing real organisational
  data.
- Geographic arrangement remains safe to explore and must not mutate
  `org_units.parent_id` or assignments.
- A unit merge always carries the complete descendant branch. The confirmation
  must say so and quantify affected child units, teams and people where those
  counts are available. Use semantically clear language such as:

  **Merge "Customer Operations" into "Service Delivery"?**

  *Customer Operations carries its entire branch: 4 child units, 11 teams and
  83 people. They will all remain together beneath the merged unit. To merge
  only Customer Operations, cancel and reassign its child units first.*

- Current actions are **Cancel** and **Merge entire branch**.
- **Review branch is deliberately deferred as a separate future feature. Do
  not build or imply it in this story.** It is noted in
  `docs/ORBITAL-INTERACTION.md` and should be raised when the next new feature
  begins.
- Merge persistence still has unresolved product questions: what happens to
  both units' directly assigned people and how the new lead is selected. Do not
  invent an answer or perform a partial/destructive merge. Implement the
  navigation, target detection and confirmation contract only as far as the
  existing data model safely supports; bring the unresolved semantic choice to
  Greg before wiring an irreversible merge.

### Staging recommendation

Keep the system demonstrable and testable after every slice. A sensible order
is:

1. Extract/test visual-complexity, effective-detail, visibility-budget and dot
   size-index functions without changing the shipped feel.
2. Introduce local branch geography and the structural envelope behind a
   deterministic activation rule; preserve the existing small-company path.
3. Add the local semantic field and align paint/culling/hit testing.
4. Refine geographic insertion preview so only the local affected set moves
   and a radial change cannot propose reparenting.
5. Add basket state and geographic placement, including ancestor/descendant
   rules and responsive touch treatment.
6. Add merge/relationship target preview and safe confirmation handoff, stopping
   before unresolved destructive semantics.

If code structure suggests a safer order, explain the deviation in plain
English and preserve the same product contract.

### Non-negotiable quality and verification

- Performance remains acceptable on a five-year-old entry-level iPad and an
  old Lenovo. Avoid per-frame React state, full-scene hit nodes and global
  relayouts during pointer movement. Preserve the existing painter/motion-store
  architecture where it helps.
- Touch is first-class: minimum 44px controls where appropriate, no hover-only
  capability, safe-area-aware basket, pinch/pan/tap verified.
- Respect `prefers-reduced-motion`; information and causality must survive when
  motion is reduced.
- Demo fixtures contain invented people only. Preserve tenant boundaries and
  do not touch production data.
- Add pure tests for layout stability, non-overlap, envelope containment,
  activation determinism, hierarchical thinning, monotonic/bounded dot area,
  local effective detail, hidden-node hit exclusion, drag affected-set locality,
  and basket ancestor/descendant rules.
- Run cheap checks first (`npx tsc --noEmit` and the relevant Vitest files),
  then the full appropriate suite.
- Visually inspect Sparrow Jam (10 people) and Digital Tailoring (45) in the
  production orbital map. Verify desktop and touch-sized viewports, ordinary
  motion and reduced motion.
- Run the 2,562-person `lib/orbital/__tests__/fixtures/deepOrg.ts` shape through
  pure scale/layout tests. That deleted demo workspace must not be recreated in
  the database just to inspect it.
- For each visual QA claim, state exactly what was exercised and what remains
  unverified. Do not call a screenshot proof of interaction.

### Acceptance experience

The finished interaction should feel like this:

1. A user opens a meaningful local region of their company.
2. Zooming behaves like a map: it stays under the gesture and reveals detail
   where the user is looking.
3. From an overview, a blank tap gently clarifies that locality. It does not
   plunge into people or work.
4. A visible node tap promotes the node, its children and its route home without
   unexpectedly changing the camera.
5. Dragging nearby shows exactly which local neighbours will make room; release
   produces that arrangement and nothing elsewhere jumps.
6. For a distant move, the user puts one or more branches in the edge basket,
   navigates freely, and places them later.
7. An ordinary drop changes geography only. A deliberate relationship target
   looks and feels different and asks before changing organisational data.
8. At maximum overview, the company reads as major occupied territory rather
   than fog, a giant empty target, or thousands of equally insistent dots.

Before editing, briefly report the current-state audit, the first reversible
slice you will implement, and any genuine conflict between this contract and
the live code. Then proceed.

