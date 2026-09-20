# Unified orbital map — integration contract

**Status:** local integration branch, not approved for `main` (2026-09-20). This
records Greg's decisions while combining the shipped `/org` orbital map with
the `/lab/grow` creation study. Test locally before any production merge.

## One map, a forest

- Creation and editing happen on the ordinary `/org` map throughout the life
  of a company. A human can exist before any team does. Never synthesize a
  company node or relationship to hold otherwise independent roots together.
- Any number of independent families may exist, each with arbitrarily deep
  children. Government/customer contributor and subtractor nodes remain an
  open question; do not force them into this model during integration.
- Every node has a local child orbit. Work items orbit humans, but are not
  organisational nodes. A real child orbit grows only enough to fit its
  contents. Its contents, not an index such as CEO+3, determine its radius.
- Wider **helper rings** aid placement but carry no reporting meaning. Start
  with four generous rings around an evident family centre. The outer boundary
  of every family stays visible; inner helpers appear only while a node or
  family is focused. Crossing the outer boundary with a branch offers **Split
  off** on release, never an automatic change.
- **Tidy up** arranges independent families with ample space (two in a line,
  three in a triangle, four in a square, more in a grid for the first pass),
  and tidies each family internally. It never invents a parent, undoes a real
  relationship, or has to zoom the camera out.

## Drag means a question, not a silent edit

- While a node is dragged near another, preview that a relationship choice is
  available. On release, ask what should happen. This works with Break orbits
  on as well as off. Open-paper placement remains visual only. The accepted
  structural choice persists immediately; a later experimental mode may make
  such choices provisional.
- A human meeting a human: two unparented people can form a team; with one
  parented, offer joining that team or making a peer team; with two parented,
  offer a move or a new peer team near the drop. Other permutations can follow
  after the first integration.
- For now a human has one **visible team home**. Preserve historical
  multi-assignment data rather than deleting it during integration, but do not
  add multi-membership creation UI. Formal reporting lines are separate from
  team membership. The current single saved `people.managerId` is retained;
  persisting multiple formal reporting lines is deferred.
- A non-person node pushed into another can be absorbed only after an explicit
  **Merge** choice. The receiving node survives in its existing place and
  family. People and child nodes transfer separately; children are not merged
  into each other. Ancestor/descendant cases must not create cycles.
- A team merge asks for its lead (either existing lead or no lead). If no lead
  is chosen, both former leads remain members of the receiving team. No
  person is silently deleted.

## Incomplete information and truthful rings

- Unnamed placeholders persist as drafts, not as real people or teams. A
  prompt near the zoom control cycles through drafts by zooming to each, where
  the user can edit or delete it. Deleting a draft parent deletes only that
  placeholder; its created children become independent, even if visually
  adrift. Never cascade-delete those children.
- A name is sufficient for a person or team to take its place. Missing role
  or purpose gives a small red notification dot and an edit prompt, not draft
  status. Existing real people with no title must remain real people.
- A progress ring is drawn only when its **particular metric has source data**.
  A measured zero is present data; missing is not zero. No ring track, hover
  target, or card meter may imply a metric that is absent. In particular, team
  health requires an explicit health measure, not an inference from missing
  vacation data or a default 100% allocation.
- Explicit demo companies may use clearly identified invented work data to
  demonstrate rings. A real/new customer company must not receive the current
  automatically generated mock work items or work-derived rings.

## Delivery and known seam

- Keep the blue/purple/cyan visual language, white field, substantial data
  rings, avatar people, zoom reveal, touch access, focus behavior, and reduced
  motion treatment from the orbital map. Carry the grow study's first-person
  creation, orbit `+`, local drag/join preview, and forest concept into it.
- The grow lab's single-parent `Node` and SVG renderer are references, not the
  live data model. The current `/org` tree builder fabricates an
  `orbital-root` when there are several roots and merges away a pass-through
  root; neither behavior can represent this contract as-is.
- This integration branch is for local testing. `main` deploys to production
  on push; Greg will review the integrated approach before approving main.

## Local test checkpoint (2026-09-20)

Implemented here, still unmerged: a cool-toned `/lab/grow` study with optional
role/purpose, missing-detail dots, explicit orbit move and boundary split
questions, independent-family tidy-up, and a placeholder finder. The first
person/team sequence, orbit `+`, and same-kind merge choices remain from the
grow study. Its state is **still browser memory only**; a refresh loses it.

The live `/org` rendering now lays out actual independent roots without drawing
the index-only synthetic root or a false link. It shows an outer boundary per
family, inner guides on focus, and limits invented work/rings to named dev demo
fixtures. The ring model distinguishes measured zero from missing data. Unit
snapping inside a forest is local to that unit's family. Sparrow and Digital
were browser-checked. A pure test still checks a >2,500-person, 11-rung layout
without touching the database. The Northwind demo workspace was **deleted from
the local development database on 2026-09-20**, so large-scale QA is now arithmetic only — nobody can look at a
big org any more, and a regression that only shows at scale will not be caught
by eye.

**Not integrated yet:** the grow interaction and draft persistence on `/org`,
branch splits/structural merge persistence in the real schema, an in-map
placeholder finder, and the final one-home/multiple-reporting-line model. The
lab's person-to-person choice is not yet the complete contextual matrix above.
This branch is a usable interaction study, **not** a production-ready unified
map. In particular, a real structural change must use workspace-scoped data
actions, not the existing `orbital_nodes` arrangement overrides.

## Follow-on scale study (2026-09-20)

On `merge/grow-looks-like-org` (not this integration branch), the shared
`GrowLab` has wheel/pinch zoom, pan, slider and Fit. Its
`/grow-established` review route uses an invented 45-person, 12-team Digital
Tailoring-shaped fixture, with the orbital palette, small illustrated people
and explicit sample data rings. The visual map and creation choices coexist
there, but all edits remain in memory. The live `/org` drag now applies saved
same-rung angles as offsets to the chosen branch after layout, instead of
repacking every sibling around a changed angle. This addresses the reported
whole-tree movement without claiming the grow interaction has been wired into
workspace-scoped mutations. Verify that seam before a production merge.
