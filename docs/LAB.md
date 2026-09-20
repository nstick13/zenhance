# Lab workflow — design sandboxes

> Throwaway pages for **feel studies** — react to pixels before committing to real components.
> Use when a design needs to be *seen*, not described. Keep them disposable.

## How a lab works
- **Location:** `app/lab/<name>/page.tsx`. One self-contained file.
- **Rules:** hardcoded mock data only. **No** DB, auth, `requireWorkspace()`, or imports from real components (`RadialOrg`, etc.). Inline styles are fine. Because it lives outside the `(app)` group and never calls `requireWorkspace()`, auth is a no-op locally and it renders standalone.
- **View it:** `npm run dev`, then `/lab/<name>`. **Check the port** — dev may already be running on **:3001** (not :3000). `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/lab/<name>` to confirm 200.
- **Verify:** `npx tsc --noEmit`, then inspect the interaction in a browser. Map studies are checked against all three demo-company scales.
- **Not production.** A lab proves a feel; the real build re-implements it against real data/components.

## Lifecycle → archive (don't delete, don't leave routes live)
When an experiment is done — **graduated** to prod *or* **abandoned**:
1. Move `app/lab/<name>/` → `app/lab/_archive/<name>/`. The `_archive` underscore makes it a **private folder** (Next App Router won't route it) — the code is preserved, the route is killed.
2. Record the verdict in the registry below (so future sessions reuse the *learning*, not re-derive it).

## Registry
| Experiment | Status | Verdict / learnings to carry forward |
|---|---|---|
| `grow` / `grow-established` | **active** | The blank-canvas start and a 45-person invented established-company variant now share `GrowLab.tsx`. Both support wheel/pinch zoom, pan and Fit. Human avatars and explicit sample team rings test convergence with `/org`. State remains in memory only. A **forest**, not a tree. Rules + open questions below. |
| `canvas` | **active** | v2 canvas map feel study (Konva). Proved the four-rung zoom ladder (Value streams→Teams→People→Roles), free-form drag, layer toggles, search-with-halo, and zones. Direction + staged plan: [V2.md](V2.md). **Two files, not one** — Konva needs `ssr: false`, and Next requires that dynamic import to live in a Client Component, so `page.tsx` is a shell around `CanvasMap.tsx`. |
| `analytics` | **archived** | Graduated to prod (2026-06-16) as `lib/analytics/findings.ts` + `FindingsRail` in `RadialOrg.tsx`. Design rationale: `PRODUCT.md` § Analytics design language. Feel: ambient = presence dots (category colour, equal weight); focus = spotlight + Signal→Narrative. |
| `orbital-focus` | **archived** | Graduated to the production `OrbitalMap` (2026-09-15). Carried forward: focus-relative fixed rings; double-click/double-tap and card focus; progressive whole-company marks; dimmed context with a violet route home; nested focus; and focus-aware dragging with meaningful snap modes. The lab's aggregate summaries were deliberately dropped because every real unit remains visible. |


## `grow` — the first team *(active, 2026-09-19)*

`/lab/grow` — a thin page around the self-contained `GrowLab.tsx` study, SVG not Konva (three to a dozen nodes don't
need a canvas, and SVG gives crisp text at any camera scale for free). No DB, no
auth: **a hard refresh wipes it**, by design. `?still=1` forces the
reduced-motion rendering so the calm version can be reviewed without changing OS
settings.

**Integration revision, 2026-09-20:** this history includes earlier rules that
have since changed. The current decision contract is
[UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md). In the local study, a name alone now
completes a node; absent role/purpose gets a red dot, not a breathing draft.
The palette is blue/purple/cyan on white. Each family has a dotted outer
boundary; three inner helper rings appear while it is in focus. Dropping a
branch outside its original boundary offers an explicit split choice. Drops
on another orbit ask before changing parent for people **and** teams. Tidy up
packs two/three/four independent roots as a line/triangle/square, then a grid.
A bottom finder cycles through unnamed placeholders and can zoom to each; an
unnamed placeholder can be deleted without deleting its children. The lab
still has no database: none of those choices survive refresh, and the
production `/org` integration remains unfinished.

**Established-scale extension, 2026-09-20:** `/lab/grow-established` (also
`/grow-established` for the review URL) starts with 45 invented people in 12
teams. It shares the same in-memory create/edit/drag choices as `/lab/grow`,
but paints human avatars and explicit sample progress rings. New nodes never
receive invented metrics. Wheel/pinch zoom, background pan, a slider and Fit
let the creation study be inspected as a whole map. This does not make the
study persistent or grant `/org` the same creation controls yet.

### The idea being tested
Greg's framing: *"the user starts with almost nothing."* One breathing `+` in the
middle. Click it and you create a **human** — not a company, not a value stream.
Three steps (name → role → *"does this person have any teammates?"*), and on
**yes** the GUI creates two nodes at once: a **parent** (the team) and a
**sibling** (the teammate). They arrive together, the camera steps back, and the
new nodes breathe because they still need data.

**The team is discovered, not declared.** That is the whole point of the
sequence, and it's why the create-human flow deliberately does *not* ask which
team the person is in — asking would mean the team already existed, and the
reveal would be dead. The team's own name and purpose are captured afterwards, by
clicking the node that's asking for them.

### Rules that came out of building it
- **A node breathes until it is *described*, not until it is named.** "Named but
  no role" is still an empty node; the sub-label always says what's missing
  (`Needs a name` / `Needs a role` / `Needs a purpose`).
- **People are spaced by how many *people* there are** — never by whether the
  `+` slot is showing. Counting the slot meant filling in the last field spun the
  whole team round to make room for it. The `+` goes in the gap instead.
- **`+` only appears when nothing is asking for attention**, and never while a
  wizard is open — otherwise it competes with the breathing nodes and moves the
  camera under the user.
- **The callout goes where it hides the least** (right / left / below / above,
  scored against the other nodes' screen boxes; a bottom sheet under 560px).
  Pinning it to one side always covers a neighbour once the ring fills in — the
  team sits *between* two people. Under 560px the map also steps up out of the
  sheet's way.
- **Nodes don't take clicks while anything is in flight.** Mid-choreography they
  overlap, and a tap lands on whatever is passing through.
- **No spokes.** They collided with the labels of any node above the centre, and
  the orbit ring already says "these people are in this team" — which is how the
  production map reads too.

### Bugs worth not repeating
- A CSS keyframe that animates `opacity` **silently overrides an SVG `opacity=""`
  attribute**. The breathing halo rendered near-solid. Tint has to ride on
  `fill-opacity`.
- Centring the map only off a `ResizeObserver` is fragile — it can be throttled
  or never deliver its first callback (hidden tab, embedded view) and the map
  draws at the wrong size. Measure on mount as well. Same cause: `rAF` doesn't
  tick in a hidden tab, so the effect now snaps to the settled state and
  publishes it outright rather than leaving the map half-arrived.
- **A node that hasn't arrived is invisible but still hit-testable**, and it is
  sitting on top of its parent — so it stole the click. Anything mid-flight has
  `pointer-events: none`.
- **`onPointerMove` is not a safe default for hover.** Plain mouse events fire
  everywhere, including the older browsers this has to run on; the ring's hover
  band uses those.
- **The browser's `click` still arrives after your own mouseup handler has run.**
  A node opens its panel on release, and the trailing click then bubbled to the
  paper and shut it again. The node has to swallow that click.
- **Drag listeners must be attached synchronously, not in an effect.** An effect
  only runs after React commits, and a quick press-and-release finishes before
  that — which silently swallowed the tap.
- 🔴 **A hover affordance drawn *under the pointer* will fight the thing that
  spawned it.** The ring's "+" appears where you are hovering, on top of the
  ring's own hit band. Taking the pointer gave the band a `mouseleave`, which
  hid the "+", which handed the pointer back to the band, which drew it again —
  a flicker loop, with clicks landing on whichever element happened to be
  there. Greg hit this as *"I had to click a few times."* The "+" on a ring is
  now **paint only** (`pointer-events: none`) and the band owns both the hover
  and the click. Anything else drawn under the cursor needs the same treatment.
- **Don't gate the whole map on "is anything animating".** A blanket
  `pointer-events: none` while the motion loop was busy was the first suspect
  for the flicker above — wrong diagnosis, but a real hazard, because the "+"
  chasing the pointer keeps the loop busy almost continuously. Each node now
  says for itself whether it has arrived.

### Growing past the first team *(2026-09-20)*
Hovering a team's **dotted orbit** reveals a `+` that rides the ring under the
pointer; clicking it (or tapping the ring, which needs no hover) offers three
things, and each one is deliberately not the same shape of change:

| Choice | What happens |
|---|---|
| **A person** | A new seat on that orbit. |
| **Something above it** | A parent is inserted *above the ring's owner*, wherever it sits — the owner and its whole subtree start orbiting the new node. |
| **Another team** | A new **island**: its own root, its own dotted orbit, placed off to one side. **No relationship is drawn or implied.** |

**The map is a forest, not a tree.** Nobody is made to declare how two teams
relate just to put them both on the paper, and there is no snapping — **Tidy
up** is the only thing that moves an island, and all it does is straighten them
into one evenly spaced row. This contradicts the single-root assumption the
first version carried, deliberately.

**Rings are sized by what stands on them, not by depth.** Adding a parent grows
the map *outwards* rather than shrinking everything inside it: a ring clears its
own node plus the deepest subtree standing on it (`GAP`), and is long enough
round for every child side by side (`PAD`). The camera then frames the whole
forest. The alternative — fixed radii per depth — turns people into specks the
moment a third rung appears.

**Children fan away from their grandparent.** Each ring's children are spread
around the direction the node itself was reached from. Placing every ring's
first child at a fixed angle laid a three-deep org out on one straight line.
The root faces "up", which is what puts the first two people left and right.

**Labels are drawn in screen space, over the scaled map**, so names stay the
same size however far out the camera goes. They carry a paper-coloured halo
(they cross the dotted rings constantly), and they **declutter**: shallower
nodes are laid down first, a crowded label drops its second line, and only then
gives up its slot entirely.

**A team's purpose never reaches the map** — it's prose, and it was wide enough
to run straight through its own people's labels. The map carries a headcount
(the whole subtree, so a parent counts everyone beneath it); the purpose stays
in the panel it was typed into.

### Moving things by hand *(2026-09-20)*
**Anything can be dragged anywhere.** A node you put somewhere stays there, its
children keep orbiting it from its new spot, and anything below it that had
also been hand-placed travels with it. **Tidy up** is the undo: every
hand-placed node goes back on its orbit and the islands straighten into a row.
The camera's auto-fit is frozen for the duration of a drag — the world must not
zoom or slide under the pointer while you're holding something.

**A drop is also a question about the org**, read the way the production map
reads it (`lib/orbital/snap.ts`, Greg 2026-09-13: *"snapping is relative to
parent orbits, rather than an absolute grid"* — radius says which level, angle
says which parent). Here the rungs aren't global (each island has its own), so
**the orbit you landed on answers both at once**:

- **Let go near an orbit** → that team is offered as the new parent. A **person**
  just moves; moving a **team** takes its whole subtree with it, so that one is
  asked about first. Either way the node gives up its hand-placed position —
  joining a team means taking a seat on it.
- **Let go on open paper** → nothing about the org changed. It has just moved.
- A node can never be dropped inside its own subtree; that would cut the
  subtree off the map (the guard `lib/orbital/snap.ts` also carries).

### Pushing two things together *(2026-09-20)*
Drag one node close to another of **the same kind** and they visibly start to
run together — a metaball neck is drawn between them, and it stays while you
decide, because the question on screen is about those two. Like pairs with
like: two teams, or two people. A person meeting a *team* is a different
question, and the orbit already asks it.

**Two people** get asked *"Do these two work together?"* — **make them a team**
(a new team closes around the pair, named during the interaction) or **put them
on the same team** (move them both onto a team already on the map). They lean
together rather than one vanishing into the other: nobody is absorbing anybody,
a team is closing around them.

**Where that new team sits depends on where the two came from.** Same team, and
it plainly belongs there — no question asked. **Different teams, and it is put
to the user** (Greg, 2026-09-20), because picking one of their parents for them
would be a coin toss: *"Where does {team} sit?"* offers each of the two parents
by name (*"where Priya already sits"*), **on its own**, or **something new** —
which makes a second node above it and opens its wizard so you can name it.

**Two teams** get asked which of two very different things you meant:

| Choice | What it does |
|---|---|
| **Make them one team** | Everything either held — teams and people alike — ends up on the survivor's ring, under a name you give during the merge. **Nothing above either team changes.** |
| **Give them a shared parent** | Both stay exactly as they are and start orbiting the same thing — an existing node, or a new one made for them. |

Choosing to merge slides one team into the other for ~420ms before they become
one, so the coalescence is something you watch rather than a jump cut (skipped
outright under reduced motion). The shared-parent route **can orphan a parent**
that has just lost its only child — allowed, by instruction.

### Wearing the shipped map's clothes *(2026-09-20)*
Greg: *"make the result look and feel visually more like /org."* The study now
takes its **maths** from the shipped engine rather than copying its look, so the
two can't drift:

- **Size comes from `lib/orbital/geometry`** — a unit is `unitRadius` (165 · 72 ·
  48 · 36 …) and a person is a `SEAT_RADIUS` seat, 9.5. Orbits stay sized by
  contents. Greg, 2026-09-20, chose "depth for size, contents for spacing",
  explicitly provisional: *"orbits around the central master node may later
  become about seniority too … I want to be able to do layout first."*
- **Size is grown from the people upwards.** A person is a 9.5 seat; a node
  that holds others covers **0.66 × the summed area of everything inside it**,
  so a team of six reads as bigger than a team of two. Greg, 2026-09-20:
  *"Humans are the base unit of a company, so they should define sizing."*
  ⚠️ This is flatter than `/org`'s 165 · 72 · 48, so the two are **not**
  pixel-identical on a deep org. That is the literal instruction; the tension
  with "look identical to /org" is Greg's to settle.
- **The zoom ladder is `lib/orbital/lod`.** People are not drawn at overview
  scale at all; a single arc (the torus) stands in for a unit's crowd from
  ~0.95×, and gives way to real avatars with their own connection lines from
  ~1.7×. Greg, 2026-09-20: *"if you zoom out in /org, then humans vanish. When
  you zoom in, first they appear as an abstraction, then as nodes with
  connection lines."*
- **Connection lines are back**, unit→unit always and out to people only as the
  people themselves arrive. Width stays flat: `/org` thickens a link by the
  money flowing down it, and there is no money here to thicken it with.
- **Data rings** are the shipped map's `ringGeometry` at 1.5× its widths —
  6.75–11.25px, a fraction of the node's own screen size rather than a fixed
  hairline, so a gauge gets chunkier as its node does. The whole stack is
  measured in the node's own drawn space, which is what stops a node growing
  out through its own rings as you zoom. They appear only where a metric has
  source data, and only once the node is big enough to carry them.
- ⚠️ **Every decoration on a node is a screen width, never a world width** —
  the outline, the pulse halo, the selection ring. A world-unit outline fattens
  on screen as you zoom in until it runs straight through the gauges outside
  it; that was the clipping Greg reported. There is then a constant `RING_CLEAR_PX`
  of air between the *outside of the outline* and the first gauge.
- **Nothing sits in the middle of a team.** The three dots that used to read as
  a symbol nobody could name are gone (Greg: *"I don't know what that is"*);
  the ring, the label and the headcount already say "team".
- **A person is a portrait, not a sticker.** The avatar is *cropped* to its seat
  with a `clipPath` rather than shrunk to fit inside it, and a white band sits
  between the picture and the coloured outline. Shrinking it left the drawing
  floating in the circle and still breaching it on the crop.
- **A name is a hover state**, on teams as well as people — provisional, and
  Greg expects to revisit it. Until then the map reads as shape and colour
  until you ask.
- **The crowd stand-in is a pale blue-grey**, not the seat colour. It stands in
  for people; it should not out-shout them.
- **People are the exception to the spacing.** A ring carrying nothing but
  humans sits at *half* the distance and packs them half as loosely; the moment
  a team stands on that ring it is a structural rung again and takes the full
  distance. Greg, 2026-09-20: *"humans now can be drawn at half the distance
  from their parent node … that should tighten things up a bit at that level."*
  It also brings the whole map in enough that the default view clears the
  gauges' legibility threshold, which the doubled spacing had pushed it below.
- **Avatars are drawn to fit their seat.** The illustration reaches ~12.5 units
  from its centre and was spilling out of a 9.5 circle.
- **The camera may now zoom past 1×** when the map is small. Capping the fit at
  1× was the other half of why the first team was invisible.

### Boundaries decide who your parent is *(2026-09-20)*
Every node's **boundary** is the circle enclosing its whole subtree. Dragging
reads two complementary things on release, in this order (Greg, 2026-09-20:
*"we're brave enough to re-parent … We can have this alongside the existing
drag-to-orbit behaviour, since it's complimentary"*):

1. **Land on an orbit** and you have chosen that team deliberately. Orbits are
   **magnetic**: the pull is an invisible band around the ring, equidistant
   inside and out, as wide as **15% of that orbit's diameter** — so a big ring
   reaches further than a small one, and the feel is the same at any zoom
   (Greg, 2026-09-20).
2. **Otherwise the boundary you are inside decides**, and the *innermost* one
   wins — so a node carried across a family's outer boundary and dropped into a
   nested one takes the nested one's parent, not the family's.
3. **Inside none of them, the node is severed** and keeps exactly where it was
   let go. That is now its own place in the world.

**Pushing two nodes together stands the gauges down.** They are replaced by
the merge shape itself, which arms while the two are still visibly apart —
their gauges reach far past their outlines, so waiting for the outlines to
touch meant the merge only appeared once they had already overlapped. The
gauges come back the moment the choice is resolved or abandoned.

**The line under your hand is the question.** While a node is held, its
connection line shows where it *would* land — it reappears on a new parent as
you cross in, and disappears as you cross out — and the boundary you are about
to drop into lights up. Releasing acts. There is no dialog.

> ⚠️ **This supersedes a line in [UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md)**,
> which records an earlier decision that crossing the outer boundary *"offers
> **Split off** on release, never an automatic change"*, and that a release
> should "ask what should happen". Greg replaced both on 2026-09-20. The
> merge choices (two teams, or two people) still ask, because those are
> genuinely ambiguous; a boundary crossing is not.

### 🔴 Known limit — depth past three rungs
Three rungs read beautifully. At **four** the camera has to pull back to about
`k≈0.22`, and while the labels stay legible the nodes become specks and start
colliding. Growing outwards buys readable text at the cost of area, and this is
where that trade runs out. The real fix is production's approach — a minimum
*on-screen* node radius bounded by the rung's radial room (`lib/orbital/lod.ts`
`drawnUnitRadius`) — plus actual zoom and pan. **Not attempted here on purpose:**
a half-done size floor makes nodes overlap, which is worse than small.

### Settled — Greg, 2026-09-20
- ✅ **Siblings never attach on their own.** A new team is always an unconnected
  island, whatever its neighbour's shape. Two teams become related only when a
  user *deliberately connects them*. Nothing about the map may quietly assert a
  relationship nobody stated — that is the point of the forest.
  **Still open: what "connect them" actually is as an interaction.** Undesigned;
  don't invent it in passing.
- ✅ **Even redistribution stays, for now.** A new person lands where you
  clicked and the ring then spaces everyone evenly. **But a manual override is
  wanted later** — reordering the people within a team, and the teams within an
  orbit. Treat the even spacing as the default, not as a rule the model depends
  on: whatever replaces it has to let a user pin an order.
- ✅ **Touch is unverified on real glass, and that's acceptable at this stage.**
  Tap-the-ring is wired and works under simulated taps.

### Open — Greg's call
1. **What does "connect two teams" mean?** (from the settled item above — the
   decision is made, the interaction is not.)
2. **Does the first person keep any special status** (they're the one who
   answered the questions), or are they just the first seat?
3. **Editing vs. adding** — clicking a finished node currently reopens its
   wizard prefilled. Fine for a feel study; probably not the real interaction.
4. **Nothing pins an island's order.** Tidy up sorts islands left-to-right by
   where they already are, so the row reshuffles if you move one. Fine for now;
   the manual ordering Greg wants will need a real answer.
5. 🔶 **Two *teams* merged into one still keep the target's place** — drag A
   onto B and the survivor sits where B sat, silently, even when A and B had
   different parents. People now get asked that question; teams do not. Greg
   has seen this and parked it (2026-09-20): *"good enough for now."* It is a
   one-step change, reusing the same panel, if the same answer should apply.
6. 🔶 **How opinionated should placement be at all?** Greg, 2026-09-20: *"I
   don't know how opinionated geographic placement of nodes should be."* This
   is the question sitting underneath several of the others — where a new
   parent appears, whether islands may overlap, whether the map should ever
   move something you didn't move yourself. Right now the lab is barely
   opinionated: things land where the action happened, overlaps are allowed,
   and **Tidy up** is the only thing that rearranges anything. Nobody has
   decided whether that is the answer or just the absence of one. **Don't
   quietly make the map more opinionated** — it would be answering this by
   stealth.

> **Related, unresolved:** `lib/orbital/model.ts` merges away a "pass-through"
> root so the company sits at the centre. On a hand-built org that rule eats the
> first unit the user creates the moment it gains a child. A partial fix (don't
> absorb a leaf) is on the parked `getting-started-wizard` branch. The real
> choice — stop merging hand-built orgs, or drop the rule — has not been put to
> Greg.
