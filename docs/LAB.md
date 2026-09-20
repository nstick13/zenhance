# Lab workflow — design sandboxes

> Throwaway pages for **feel studies** — react to pixels before committing to real components.
> Use when a design needs to be *seen*, not described. Keep them disposable.

## How a lab works
- **Location:** `app/lab/<name>/page.tsx`. One self-contained file.
- **Rules:** hardcoded mock data only. **No** DB, auth, `requireWorkspace()`, or imports from real components (`RadialOrg`, etc.). Inline styles are fine. Because it lives outside the `(app)` group and never calls `requireWorkspace()`, auth is a no-op locally and it renders standalone.
- **View it:** `npm run dev`, then `/lab/<name>`. **Check the port** — dev may already be running on **:3001** (not :3000). `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/lab/<name>` to confirm 200.
- **Verify:** `npx tsc --noEmit` only. **Nate eyeballs the UI himself — no preview screenshots** (house rule).
- **Not production.** A lab proves a feel; the real build re-implements it against real data/components.

## Lifecycle → archive (don't delete, don't leave routes live)
When an experiment is done — **graduated** to prod *or* **abandoned**:
1. Move `app/lab/<name>/` → `app/lab/_archive/<name>/`. The `_archive` underscore makes it a **private folder** (Next App Router won't route it) — the code is preserved, the route is killed.
2. Record the verdict in the registry below (so future sessions reuse the *learning*, not re-derive it).

## Registry
| Experiment | Status | Verdict / learnings to carry forward |
|---|---|---|
| `grow` | **active** | The blank-canvas start: grow an org one node at a time, let the *team* appear rather than be declared, then grow outwards from the orbit rings. A **forest**, not a tree. Rules + open questions below. |
| `canvas` | **active** | v2 canvas map feel study (Konva). Proved the four-rung zoom ladder (Value streams→Teams→People→Roles), free-form drag, layer toggles, search-with-halo, and zones. Direction + staged plan: [V2.md](V2.md). **Two files, not one** — Konva needs `ssr: false`, and Next requires that dynamic import to live in a Client Component, so `page.tsx` is a shell around `CanvasMap.tsx`. |
| `analytics` | **archived** | Graduated to prod (2026-06-16) as `lib/analytics/findings.ts` + `FindingsRail` in `RadialOrg.tsx`. Design rationale: `PRODUCT.md` § Analytics design language. Feel: ambient = presence dots (category colour, equal weight); focus = spotlight + Signal→Narrative. |


## `grow` — the first team *(active, 2026-09-19)*

`/lab/grow` — one self-contained file, SVG not Konva (three to a dozen nodes don't
need a canvas, and SVG gives crisp text at any camera scale for free). No DB, no
auth: **a hard refresh wipes it**, by design. `?still=1` forces the
reduced-motion rendering so the calm version can be reviewed without changing OS
settings.

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

### 🔴 Known limit — depth past three rungs
Three rungs read beautifully. At **four** the camera has to pull back to about
`k≈0.22`, and while the labels stay legible the nodes become specks and start
colliding. Growing outwards buys readable text at the cost of area, and this is
where that trade runs out. The real fix is production's approach — a minimum
*on-screen* node radius bounded by the rung's radial room (`lib/orbital/lod.ts`
`drawnUnitRadius`) — plus actual zoom and pan. **Not attempted here on purpose:**
a half-done size floor makes nodes overlap, which is worse than small.

### Open — Greg's call
1. **Should a sibling team ever attach?** Right now "another team" always makes
   an unconnected island, even when the ring's owner already has a parent it
   could plausibly join. That is the literal spec, and it may be exactly right —
   but it means the map can never express "these two are siblings" until
   somebody adds the parent by hand.
2. **A new person lands on the ring, then the ring redistributes evenly.** You
   don't get to keep the angle you clicked at. That is what makes the ring read
   as a ring; it also means placement is never yours.
3. **Does the first person keep any special status** (they're the one who
   answered the questions), or are they just the first seat?
4. **Editing vs. adding** — clicking a finished node currently reopens its
   wizard prefilled. Fine for a feel study; probably not the real interaction.
5. **Tidy up is the only layout control.** No drag, no snapping — by instruction.

> **Related, unresolved:** `lib/orbital/model.ts` merges away a "pass-through"
> root so the company sits at the centre. On a hand-built org that rule eats the
> first unit the user creates the moment it gains a child. A partial fix (don't
> absorb a leaf) is on the parked `getting-started-wizard` branch. The real
> choice — stop merging hand-built orgs, or drop the rule — has not been put to
> Greg.
