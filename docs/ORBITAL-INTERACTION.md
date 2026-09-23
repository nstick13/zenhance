# Orbital map — interaction brief

**Status:** historical interaction brief from 2026-09-15. Greg paused the earlier large-company interactive demo on 2026-09-19; a new navigation direction was agreed on 2026-09-21 and is linked below. On 2026-09-20 the Northwind demo workspace was deleted from the local development database; only its shape-generator survives, as a test fixture. Visual exploration lives on Sparrow Jam (10) and Digital Tailoring (45). Points below record the prior direction; they are not a mandate to keep extending the enterprise treatment.

**Next-session handoff:** the newer large-company navigation decisions and a
ready-to-run build prompt are in
[LARGE-COMPANY-NAVIGATION-PROMPT.md](LARGE-COMPANY-NAVIGATION-PROMPT.md).

**Built 2026-09-22/23 — read [LARGE-COMPANY-NAVIGATION.md](LARGE-COMPANY-NAVIGATION.md) first.**
It supersedes three things below, all on `orbital-large-navigation`:

- **§2 "Click-away exits the current focus" is gone.** A blank tap pins the
  local detail field and clears the selection. Focus is left by its breadcrumb,
  the ✕ beside it, or Esc.
- **§3 "Dropping a node on a different ring changes that unit's level" is
  gone.** A unit's rendered connection length remains geography. Every
  potential parent now offers a separate semantic interaction annulus; dropping
  on another parent's annulus asks **"Move [branch] under [parent]?"** and only
  confirmation changes `org_units.parent_id`. The carried branch stays intact,
  descendants keep their authored arrangements, and cycles are rejected again
  on the workspace-scoped server action.
- **§3/§4 A unit now lands exactly where the hand let go** (2026-09-23), at
  any distance from its parent, and reloads there — `orbital_nodes.distance`.
  It is never pulled onto an orbit after release, and a spot that cannot hold
  it is refused *before* release. Open ground is an ordinary saved landing, not
  a session-only one.
- **§6 A reparent must be held, not merely released on.** Dropping on another
  parent's interaction ring in passing just places the unit; the ring fills
  while the hand holds still, and only then does release ask. A unit's own
  parent is never a merge or reparent target — moving round your parent is
  geography.
- **§5 "Dropping a person onto a different team moves them" now asks first,**
  and still changes the map only, not their membership in People and Teams.

## Current small-company decision (2026-09-19)

- **Orbits is the normal view:** the company is laid out on defined reporting rings, with calculated placement where no saved arrangement exists. The existing snapped drag remains available for small adjustments and still does not silently rewrite the org of record.
- **Break orbits** enters a whiteboard mode. Nodes and people can be freely placed; a unit carries its branch. Placement is purely visual, including when a person is dropped on another team's circle. This mode makes no reporting-line or assignment changes.
- **Tidy up** returns to normal Orbits and clears map arrangement overrides, including earlier snapped adjustments. It does not alter the actual `org_units` or `assignments` records, and it leaves the camera to the user except for reframing an active local focus.
- Free whiteboard offsets are session-only in this first pass. Saving alternative boards or scenarios needs a separate product decision; do not imply that a whiteboard layout survives reload.

## GUI direction (2026-09-20)

- Use the white `#fefefe` field and a blue/purple/cyan orbital palette. Team-health warnings may still shift amber or red: that colour has meaning.
- Remove the filled reporting-band fields and ambient dust. Show a single, uniformly styled dotted guide at each reporting layer's **actual snap radius**; this is a guide, not a region or a data value. The existing layout and reporting relationships are unchanged. Equalising the *distance between* guides is a separate layout question and was deliberately not folded into this paint pass.
- Unit names live inside a circle only from `0.7x` and only if the drawn circle has space; otherwise hover/tap reveals them. External-body labels follow the same zoom gate and have their own hover/tap name. Human names never draw by default; tapping or hovering a face reveals the person card. Photos come from the existing person photo URL when present; deterministic illustrated faces mark demo people until licensed/synthetic assets are supplied. Open roles retain a distinct dashed seat.
- Three stronger concentric progress rings sit close to the unit disc, with rounded ends and a visible track, inspired by Greg's Apple Fitness screenshot. The company-centre rings show at maximum zoom-out. Additional layers reveal progressively with zoom instead of appearing across the whole map at once. The underlying delivery/sprint/health values are unchanged.
- Unit discs draw slightly smaller than their layout geometry and cast a more visible cool shadow. This is a visual pass, **not** a change to structural geometry, snapping, or persistence. Revisit actual band spacing and oversized deep-zoom discs as a separate spatial-design story.

### Drag freeze found in GUI QA

A snapped unit drop starts a landing ripple. The ripple painter threw `ReferenceError: lerp is not defined` in the dev runtime, interrupting the Konva frame before the dragged branch could spring back to its orbital target; the dotted guides continued to mark the original centre, making the map look detached. The painter now computes its simple 5→1 stroke taper directly, and `render.test.ts` drives a non-empty ripple through the painter to catch another frame-breaking exception. Verified by dragging a Digital Tailoring unit, letting it settle, then panning: nodes and guides stayed together. The test arrangement was removed with Tidy up afterward.

## The goal

An easy, interactive, intuitive way to see what is normally an org chart. Every choice below should serve that.

## What to keep from each version

- **From the production orbital map (`main`):** dragging nodes and people with smooth spring motion; rings that show level (CEO+1, +2…); a dragged node carrying its branch; moving people between teams; the route highlight from the company to a clicked unit; people and work appearing as you zoom in; the three real demo companies and saved arrangements.
- **From the lab (`/lab/orbital-focus`):** double-click to focus a unit; the drilldown card with relevant information; large companies staying readable fully zoomed out.

**What Greg found bad in the lab:** it doesn't show the full extent of a company when zoomed out; it jumps between states instead of moving smoothly; nodes can't be moved; the snap toggle does nothing useful.

**Also found in review:** the 10- and 45-person companies are straight chains (all three use the big-company generator, which grows depth-first), nodes overlap in the focus view, double-clicking selects label text, and the commit message doesn't say why.

## Recommended approach

Build this into the production orbital map on the branch (`components/viz/orbital/OrbitalMap.tsx`, `lib/orbital/*`), not the lab. Production already has dragging, springs, ring snapping, branch-carrying, moving people, the route highlight, zoom-dependent detail, the real companies and saved arrangements; the lab adds focus and the drilldown card. Porting those across is far less work than rebuilding the rest in a lab — `LAB.md` doesn't allow labs to import real components, and the lab's data has no individual people. Keep the lab as a reference until focus is ported, then archive it per `LAB.md`.

## 1. Wide view — Decided

Fully zoomed out, or when the company itself is at the centre:

- The top few levels are labelled circles.
- Every deeper unit is still drawn, as a small dot. Nothing is hidden — no summary circles standing in for branches. You see the company's whole shape and size.
- Dots grow into circles as you zoom toward them.

`drawnUnitRadius` in `lib/orbital/lod.ts` already gives depth-based minimum on-screen sizes and is likely the starting point.

## 2. Focus — Decided

- **Enter:** double-click a unit (double-tap on touch), or a visible Focus button on its drilldown card — the dependable route on touch devices.
- The view zooms smoothly into that unit. No jumps.
- **The focused unit becomes the central node.** Its children arrange on the first ring around it, grandchildren on the second — exactly as if it were the company.
- Everything outside its branch is pushed out of focus; its parent falls outside the focal zone.
- A visible connection runs from the focused unit out to its parent.
- **While focused, everything behaves exactly as unfocused:** snaps on or off, moving nodes and people, zooming.
- You can focus a child while already focused.
- **Unfocus steps back one focus at a time.** Click-away exits the current focus and restores master geography, but keeps the current camera scale; the user decides when to zoom back out. From a first focus, semantic context returns to the whole company.
- With snaps off, focus centres the camera but does not pull nearby nodes into a local orbital arrangement.

**Assumed:** changes made while focused stay after you unfocus — unfocus restores the view, not the data. The route highlight stays available while focused.

## 3. Snaps on — Decided

- Each level has its own ring around whatever is central — the company, or the focused unit.
- A child sits on the next ring out, beside its parent.
- Dragging a node snaps it to the nearest valid spot on a ring; its whole branch moves with it.
- **Dropping a node on a different ring changes that unit's level** — a real restructure, only after a confirm step. Its branch moves up or down a level with it.
- Dropping a node **onto another node** is not a level change — that's merge (section 6).

**Assumed:** moving a node around its own ring is visual only, even if it lands beside a different parent's units — its connection line still shows its real parent. Switching snaps on doesn't move anything by itself; nodes snap when next dragged. (A separate "tidy up" comes later.)

**Open:** a new level means a new parent. *Proposed:* the confirm step suggests the nearest unit on the ring just inside; the user can pick another or cancel. Build up to the confirm step only.

**Change from production today:** on `main`, the angle you drop at silently picks a new parent. Remove that. Position around a ring never changes who a unit reports to — only the confirm step above, or the future connection-line tool, does.

**Built refinement, 2026-09-23:** rendered link length no longer chooses a
parent. A generous semantic annulus does. The current parent's annulus is
ignored so ordinary motion around home stays geographical; self and the whole
carried descendant set are ineligible. The strongest eligible annulus and its
prospective connection line are shown before release.

## 4. Snaps off — Decided

- Place nodes anywhere. Position means nothing and never changes the org.
- Dragging a node drags its whole branch with it.

## 5. People — Decided

- People can be dragged, snaps on or off.
- **Dropping a person onto a different team moves them to that team** — keep production's existing behaviour.
- Dropping a person anywhere else doesn't change their team: with snaps on they return to their team's orbit; with snaps off they stay where dropped.

**Open:** should moving a person to another team ask for confirmation, as a level change does? Until Greg answers, keep production's behaviour (moves immediately).

## 6. Merge — Decided, build after sections 1–5

- Placing nodes near each other does nothing until they enter the magnetic
  approach band. There, before full overlap, the units pull to a kissing state,
  their gauges stand down and the grow-study metaball bridge appears.
- Deliberately dwelling or pushing one node into another arms the relationship
  question; a quick pass cannot. Retreat restores the ordinary map immediately.
  Reduced motion shows the joined state immediately without travel.
- A short wizard: **Merge?** → if yes, **who is the new lead?**
- **Decision updated 2026-09-23:** unit contact offers **Reparent branch**
  (enabled), **Merge entire branch** (disabled pending the decisions below),
  and **Cancel**. Reparenting moves the contacted unit and its complete
  descendant branch beneath the target using the real workspace-scoped org
  operation. No structural change is committed without confirmation.
- A future **Review branch** action may highlight every affected descendant before confirmation. This is deliberately deferred as a feature of its own; do not include it in the current pan/zoom/large-company build. Raise it with Greg the next time a new feature or story is started.
- What happens to the two units' directly assigned people and how the new lead is chosen still needs a separate product decision before merge is built. **As of 2026-09-23 the gesture, the target treatment and the confirmation exist; its "Merge entire branch" button is deliberately disabled until that decision is made.**

## 7. Not yet — known, don't build

Create (how a new unit is added is undecided); the merge-confirmation **Review branch** interaction; a Miro-style connection-line tool for changing reporting lines; tidy up; grouping or encircling nodes; an admin freezing the real version while others edit in a sandbox, with permissions; several people editing at once.

## Quality bar

- Runs well on a five-year-old entry-level iPad and a ten-year-old Lenovo. Smooth motion is the enhancement; fall back gracefully and respect reduced-motion settings.
- Touch is first-class: focus by double-tap and by button; drag by touch.
- Check every change on both interactive demo companies: Sparrow Jam (10 people) and Digital Tailoring (45). The local Northwind demo was deleted on 2026-09-20; its scale shape remains in a pure test.
- Nodes don't overlap after a snap. Double-clicking doesn't select text.
- Commit messages say why, not just what.
