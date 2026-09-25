# Tasks

Loose ends, decisions waiting on a human, and things noticed in passing that
would be wrong to fix silently inside someone else's change.

**This list is for every agent — Claude, ChatGPT/Codex, whoever comes next.**
The repo is the only channel we share, so a task that lives in a chat window
does not exist. If you notice something and cannot fix it in the change you
are making, put it here.

Not a roadmap. [ROADMAP.md](ROADMAP.md) is what we are *building*; this is
what is *outstanding*. If an item turns out to be a feature, write it up there
and leave a one-line pointer here.

## How to use it

- **Taking one?** Change `☐` to `▶` and put your name and the date next to it,
  so nobody starts the same thing twice. Push that change before you start —
  an unpushed claim is invisible.
- **Done?** Change it to `☑`, add the commit's first line, and move it to
  *Recently done* at the bottom. Delete anything there older than about a
  month; the git log is the real record.
- **Blocked on Greg or Nate?** Leave it under *Waiting on a decision* and say
  plainly what the question is. Don't guess and don't let it quietly rot.
- **Adding one?** Say what, why it matters, and where to start. A task nobody
  can pick up without asking you what you meant is not a task.

Status: `☐` open · `▶` in progress · `☑` done · `⏸` parked deliberately

---

## 🔴 Blocking a release

### ☐ Apply migration `0009` to Neon before `next` ever reaches `main`

```sql
ALTER TABLE "orbital_nodes" ADD COLUMN "distance" numeric(12, 3);
```

`lib/db/migrations/0009_mute_longshot.sql` is on `next` and **not on `main`**.
It arrived in `151810d` ("four laws for the layout engine").

`getOrbitalNodes` in `lib/data/queries.ts` does `db.select()`, which asks for
every column Drizzle knows about. Until `distance` exists in Neon that query
throws, and it is called from `app/(app)/org/page.tsx` — so **`/org` returns
500**. `requireWorkspace` does not touch `orbital_nodes`, so the rest of the
app stays up; it is the map page, not the whole site.

**Paste the bare SQL into Neon's SQL editor first, then push.** Not wrapped in
`psql ... -c '...'` — that gives `syntax error at or near "psql"`
(SQLSTATE 42601). This is the `0005` lesson in ROADMAP.md, which was a real
outage once already.

*Who: Greg or Nate — it touches the production database.*

---

## 🟡 Waiting on a decision

Agents should not settle these alone. Each one changes how the product feels
or what it costs, and that is not a refactor's call.

### ☐ Break orbits is a one-way door

`components/viz/orbital/OrbitalMap.tsx` (~line 2874):

```jsx
{snapping ? (
  <button ... onClick={() => { ...; setSnapping(false); }}>Break orbits</button>
) : (
  <span role="status" style={S.modeIndicator}>Whiteboard mode</span>
)}
```

The button **replaces itself with a static label**. `setSnapping(true)` exists
in exactly one other place — `resetArrangement`, the "Tidy up" button — which
also clears `overrides`, `angleOverrides`, `unitOffsetsRef`, `seatOffsetsRef`
and the saved `orbital_nodes` rows.

So once you break orbits there is **no way back to snapped orbits that keeps
what you just arranged**. Someone who breaks orbits to look at something, then
wants their orbits back, loses their work. Pre-existing; noticed 2026-09-24
while extracting the growth engine and deliberately left alone.

**The question for Greg:** when you come back to orbits, should your free
placements be *kept* (the map stays as you left it, snapping applies only to
what you move next) or *re-snapped* (everything springs back to the calculated
layout)? The code is easy either way; the feel is completely different.

Start at `S.modeIndicator` and `resetArrangement` in `OrbitalMap.tsx`, and
[ORBITAL-INTERACTION.md](ORBITAL-INTERACTION.md) for what has already been
decided about whiteboard mode.

### ☐ With snaps off, the basket and the map disagree

`lib/map/growth/drop.ts` carries a ⚠️ block explaining this, and a test pins
each side so neither drifts further.

A node dragged **out of the basket** arrives with a free *plan*, commits
through the planner, ripples, and counts as placed. The **same node dragged on
the map** arrives with no plan and has its delta applied raw — no ripple, no
count. The difference is an accident of the two paths having been written
separately; it is not a decision anyone made.

**The question for Greg:** should free placement give feedback (ripple, and
count toward "placed this session") or stay silent? Break orbits is documented
as "a way to look, not a way to arrange", which argues for silent — but the
basket route has been shipping the noisy version.

### ☐ The findings rail is gone, and it used to ship

Retiring `RadialOrg.tsx` on 2026-09-24 took the **findings rail** and the
**formal (`managerId`) layer** with it. ROADMAP's "Retire the radial" entry had
asked for both to port *first*; they did not.

The maths is untouched and unreferenced — `lib/analytics/findings.ts`,
`allocation.ts`, `gaps.ts`, `rollup.ts` — as are `lib/canvas/myView.ts`,
`moneyFlow.ts`, `allocationFlow.ts` and `lineRouting.ts`. See
[ENGINES.md](ENGINES.md) § *Currently unreferenced, kept on purpose*.

**Analytics is design-first** (AGENTS.md), so this waits for that pass rather
than an agent rebuilding a rail nobody has designed for the orbital map.
Decide there whether the orphaned modules get rebuilt on or deleted.

### ☐ Make `next` the default branch on GitHub

So PRs and fresh clones land on the trunk and `main` stays deliberate.
One setting in the repo's GitHub settings. Greg or Nate.

---

## 🟢 Ready for any agent

Nothing here needs permission beyond the usual house rules.

### ☐ Add CI — there is currently none

No `.github/workflows`, no husky, no git hooks. **Nothing runs automatically.**
568 tests, a clean typecheck and a working build protect nothing on their own:
they run when somebody remembers.

A short workflow on every push to `next` and every PR:

```
npx tsc --noEmit
npx vitest run
npm run build
```

That turns three conventions into three guarantees, and it is the cheapest
safety this repo can buy.

*A second check — failing when a migration exists on the branch but not in the
deployed schema — would have caught `0009` above. That one needs a read-only
Neon connection string in CI, so it is a decision, not a chore.*

### ☐ Clear the 8 standing lint errors in `OrbitalMap.tsx`

`npx eslint components/viz/orbital/OrbitalMap.tsx` reports 10 problems
(8 errors, 2 warnings). All pre-existing, and the number has been held flat
through five engine extractions — treat it as the baseline and do not let it
grow.

Mostly `react-hooks/refs` ("cannot access refs during render") and one
`react-hooks/set-state-in-effect`. Real smells in a 3,600-line component with
54 refs, not lint noise. Best done alongside the runtime extraction below,
since several are the frame loop reaching into render.

### ☐ `/grow-established` and `/grow-large` are top-level routes

Not under `/lab`. Harmless while `next` only gets preview builds, but they
would be publicly reachable the moment this reaches `main`. Either move them
under `/lab` or accept them deliberately and note why.

Files: `app/grow-established/page.tsx`, `app/grow-large/page.tsx`.

---

## 🔵 Finishing the engine split

The six engines are separated ([ENGINES.md](ENGINES.md)). These are the
deliberate leftovers, each recorded there with its reason.

### ☐ Camera: focus *policy* still lives in the map

`enterFocus`, `leaveFocus`, `focusFromBreadcrumb` and the pending-camera
effect. They are thin and call the engine for every number, but deciding
*what to frame* needs the scene and the tree — a layout question wearing
camera clothes. Do it with the layout work, not on its own.

### ☐ Signal: the cards still live in the map

`OrbitalUnitCard`, `OrbitalHoverCard`, `Meter` — about 310 lines.
Presentational; they move with the component's chrome rather than alone.

### ☐ Runtime: the frame loop, `hitTest` and `buildTargets`

The largest remaining knot: one `useEffect` of ~270 lines touching 33 refs.
**Do not naively distribute it** — a per-frame loop reading one object is
fast, and six hooks each doing their own pass is not. On a five-year-old iPad
that difference is the whole product. ENGINES.md § *The knot, stated plainly*
has the shape to aim for.

### ☐ The `S` style object — ~395 lines of inline styles

At the bottom of `OrbitalMap.tsx`. Mechanical; worth doing once the hooks
above have taken their UI with them, so it can be split per engine rather than
moved wholesale.

---

## 🟣 Bigger pieces

### ⏸ Phase 3 — converge `GrowLab` into the growth engine

**This is the one that reaches customers.** The shipped Konva map can
rearrange but cannot *create*; `app/lab/grow/GrowLab.tsx` (3,320 lines of SVG)
can create but is a lab study. Two implementations of the same idea in two
rendering technologies.

Port the creation flow into `lib/map/growth/` as a headless hook the shipped
map consumes, then retire the SVG duplicate. `drop.ts` is the shape its drops
should land in. See ENGINES.md § Growth and [UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md).

Parked rather than open because it is a week of work and wants a decision
about what "create" means on a real workspace first.

### ⏸ Work is invented, end to end

Every task on the map comes from `lib/mock/personTasks.ts`. There is no
tracker integration and the UI says so on each panel. Integrations are
explicitly later (AGENTS.md), so this is a marker, not a task — but nothing
should be built that makes a real Jira/WorkBoard feed harder to slot in.

---

## Recently done

*2026-09-24/25 — the six-engine split. Keep this short; the git log is the
real record.*

- ☑ Repo reconciled: 23 branches → 2 (`main`, `next`), every retired tip kept
  as an `archive/*` tag — "Make the docs tell the truth about two branches and
  one map"
- ☑ Canvas and Radial maps retired; Orbital is the only map — "Retire the two
  alternate maps, so there is one map to make excellent"
- ☑ Six engines named, with a test that enforces the import rule — "Name the
  six engines, and make a test hold the line between them"
- ☑ Camera · Basket · Work · Signal · Growth extracted, then Layout moved —
  "Give every engine its own directory — the split is finished"
