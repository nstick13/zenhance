# Tasks

Loose ends, decisions waiting on a human, and things noticed in passing that
would be wrong to fix silently inside someone else's change.

**Two audiences, and the order matters.** Greg and Nate don't code, so every
item starts with a plain-English paragraph: what it is, why it matters, and
what — if anything — is being asked of them. The detail an agent needs comes
after, under *For whoever picks it up*. **If you add a task and can't write
the plain-English part, you don't understand it well enough yet.**

**This list is for every agent — Claude, ChatGPT/Codex, whoever comes next.**
The repo is the only channel we share, so a task that lives in a chat window
does not exist.

Not a roadmap. [ROADMAP.md](ROADMAP.md) is what we are *building*; this is
what is *outstanding*. If an item turns out to be a feature, write it up there
and leave a one-line pointer here.

## How to use it

- **Taking one?** Change `☐` to `▶`, add your name and the date, and **push
  that before you start**. An unpushed claim is invisible, which is how two
  agents end up doing the same work.
- **Done?** Change it to `☑`, add the commit's first line, move it to
  *Recently done*. Delete anything there older than about a month.
- **Blocked on Greg or Nate?** Leave it under *Waiting on a decision* and say
  plainly what the question is. Don't guess, and don't let it quietly rot.

Status: `☐` open · `▶` in progress · `☑` done · `⏸` parked deliberately

---

## 🔴 Blocking a release

### ☐ Tell the database about the new column before anything goes live

The app keeps its data in a database, hosted by a company called Neon. When we
add a new *kind* of information, the database has to be told about it first.
That instruction is called a **migration**.

We added one: every node on the map can now remember **how far it sits from
its parent**. The code that uses it is ready. The database has not been told.

**If we release before telling it, the map page breaks** — anyone opening
`/org` gets an error page instead of their company. The rest of the app keeps
working; it is the map, not the whole site.

The fix takes about a minute: paste one line into Neon's web console. It has
to be Greg or Nate, because it touches the real customer database and that is
never an agent's call.

> **This has bitten us before.** In ROADMAP.md, migration `0005` went out in
> the wrong order and took every page down, not just one.

*For whoever picks it up:* `lib/db/migrations/0009_mute_longshot.sql` is on
`next`, not on `main`; it arrived in `151810d`. `getOrbitalNodes` in
`lib/data/queries.ts` does `db.select()`, so it asks for every column Drizzle
knows about and throws until `distance` exists. Called from
`app/(app)/org/page.tsx`. `requireWorkspace` doesn't touch `orbital_nodes`,
which is why the blast radius is one page. Paste the **bare SQL** into Neon's
editor — wrapping it in `psql ... -c '...'` gives `syntax error at or near
"psql"` (SQLSTATE 42601).

```sql
ALTER TABLE "orbital_nodes" ADD COLUMN "distance" numeric(12, 3);
```

---

## 🟡 Waiting on a decision

Agents should not settle these alone. Each changes how the product feels or
what it costs, and that is not a refactor's call.

### ⏸ Break orbits is a one-way door — *parked by Greg, 2026-09-25*

"Break orbits" lets you move nodes freely, ignoring the rings. Turning it on
**replaces its own button with a label**, so there is no way back. The only
route to normal orbits is "Tidy up" — which also throws away every placement
you just made.

So: break orbits to look at something, want your rings back, lose your work.

**The question, for when you want it:** coming back to orbits, should your
free placements be *kept* (the map stays as you left it; snapping applies only
to what you move next) or *re-snapped* (everything springs back to the
calculated layout)? Same effort either way; completely different feel.

*For whoever picks it up:* `components/viz/orbital/OrbitalMap.tsx` ~line 2874.

```jsx
{snapping ? (
  <button ... onClick={() => { ...; setSnapping(false); }}>Break orbits</button>
) : (
  <span role="status" style={S.modeIndicator}>Whiteboard mode</span>
)}
```

`setSnapping(true)` exists in exactly one other place — `resetArrangement`,
which also clears `overrides`, `angleOverrides`, `unitOffsetsRef`,
`seatOffsetsRef` and the saved `orbital_nodes` rows. Pre-existing; noticed
2026-09-24 while extracting the growth engine. Context in
[ORBITAL-INTERACTION.md](ORBITAL-INTERACTION.md).

### ☐ Moving a node two ways gives two different results

There are two ways to move a node: drag it across the map, or drop it in the
basket and pull it out somewhere else.

With "Break orbits" on, those two routes behave **differently**. One plays a
small ripple and counts the move as a placement; the other just moves the node
silently. Nobody decided that — it is an accident of the two paths having been
written separately, at different times.

**The question:** should free placement give you feedback, or stay quiet?
Break orbits is described in our own notes as *"a way to look, not a way to
arrange"*, which argues for quiet — but the basket route has been shipping the
noisy version, and it may simply feel better.

*For whoever picks it up:* `lib/map/growth/drop.ts` carries a ⚠️ block
explaining it, and a test pins each side so neither drifts further. The basket
route arrives with a free `InsertionPlan` and commits through `commitPlan`
(ripple + `setSessionPlaced`); the map route arrives with no plan and has its
delta applied raw.

### ☐ We lost the panel that surfaced problems

The old **Radial** map — deleted on 2026-09-24 — carried a side panel called
the *findings rail*. It surfaced things worth knowing: people allocated over
100%, teams with no owner, gaps against the ideal team shape. That map also
showed the **formal reporting lines** (the HR org chart) as something distinct
from how work actually flows.

Both disappeared with it. **The calculations are completely intact** — nothing
was deleted except the display — but there is currently nowhere to see them.

This was not an accident of the clean-up alone: the roadmap entry asked for
both to be moved onto the new map *first*, and that never happened. It is
recorded loudly in ROADMAP.md rather than buried.

**Nothing is being asked yet.** Analytics is design-first in our own rules, so
this waits for that conversation rather than an agent rebuilding a panel
nobody has designed for the orbital map. Decide there whether it comes back,
in what form, and whether the untouched maths gets rebuilt on or deleted.

*For whoever picks it up:* the orphaned pure modules are
`lib/analytics/findings.ts`, `allocation.ts`, `gaps.ts`, `rollup.ts` and
`lib/canvas/myView.ts`, `moneyFlow.ts`, `allocationFlow.ts`,
`lineRouting.ts` — listed in [ENGINES.md](ENGINES.md) § *Currently
unreferenced, kept on purpose*.

### ☐ Make preview URLs private — one Vercel setting

`lab`, `next` and `release` each run on a real, working URL. Search engines
are now told to stay away from them, and the lab pages have vanished from
production — but **none of that stops anyone who has a link from opening
one.** Right now a preview URL is effectively semi-public.

The fix is one setting: **Vercel Deployment Protection**, set to require
Vercel authentication on all preview deployments. Then only people on the
team can open one.

Until it's on, previews are fine for invented demo companies and are not
somewhere to point a customer's real data.

*Greg or Nate — it's in the Vercel dashboard, not something an agent can do.*

### ☐ Give `release` a database of its own

The `release` stage exists to be a dress rehearsal — as close to the real
thing as we can make it, so a migration or a slow query fails there instead of
in front of a customer. See [ENVIRONMENTS.md](ENVIRONMENTS.md).

It can't do that job sharing the demo database. It wants a **Neon branch** —
Neon can make a copy of production's shape and volume with none of its
consequences — pointed at by `release` only.

**Two things to check or decide, both in dashboards, neither an agent's call:**

1. **What database do preview deployments use today?** If Vercel's preview
   environment variables were never set separately, every preview build has
   been reading and writing the **production** database. Five minutes in the
   Vercel dashboard settles it, and it matters more than anything else on this
   page.
2. **Create the Neon branch for `release`** and set `DATABASE_URL` for that
   branch's deployments. It costs something, so it is a call, not a chore.

Until that exists, `release` is a rehearsal in costume: better than nothing,
but it will not catch the volume-and-migration problems it is there for.

### ☐ Point GitHub at the working branch, not production

GitHub has a "default" branch: the one people land on when they open the
project, and the one new work aims at unless told otherwise. Ours is still
`main`, which is **production** — what customers see.

It should be `next`, where the work actually happens, so nobody aims at
production by accident. It is one setting in the repository's GitHub page.
Greg or Nate.

---

## 🟢 Ready for any agent

Nothing here needs permission beyond the usual house rules.

### ⏸ pnpm would make extra stages nearly free — attempted, stopped

**The problem it solves:** `node_modules` is 572MB, and npm copies it into
every checkout. Two stages side by side costs about 1.2GB; four costs 2.4GB.
pnpm keeps one shared store and hard-links into each project, so the second
checkout would cost almost nothing.

**Why it's parked (2026-09-25):** corepack couldn't fetch pnpm from the
sandbox this agent runs in. That left a broken `pnpm` on the PATH — since
removed, and `npm` is unaffected — but it means the migration can't be
*verified* here: not the install, not the build, not whether Vercel picks it
up. Changing how everything installs, without being able to prove it works,
is the opposite of reducing risk.

**Worth knowing before anyone tries again:** the numbers say this is a
convenience, not a necessity. Your code is 2.0MB. What a user downloads is
2.1MB. What Vercel deploys is 23MB. The 572MB is compilers — 286MB of it is
Next and its Rust compiler, which exist only to produce that 2.1MB. None of it
ships.

So the honest ranking: `npm run stage:clean` after a comparison keeps this at
one checkout and costs nothing. pnpm is worth doing when someone wants three
or four stages live at once, and should be done by a human who can watch a
Vercel deploy succeed afterwards.

*For whoever picks it up:* `corepack enable pnpm` then `pnpm import` to
convert the lockfile; add `packageManager` to package.json; add a `preinstall`
guard so a stray `npm install` can't recreate `package-lock.json`; check
Vercel detects pnpm (it does, from the lockfile) **before** promoting to
`main`.

### ☐ Nothing checks our work automatically

Most software projects have a robot that inspects every change the moment it
arrives: does it compile, do the tests pass, does it build. It's called CI.

**We have none.** There are 568 tests, and they only run when an agent
remembers to run them. The rule that "`main` always builds" holds because
people have been careful, not because anything enforces it.

Adding it means a broken change gets caught in about a minute, automatically,
before it can reach Greg or a customer. It is roughly twenty lines of
configuration and the cheapest safety this repo can buy.

*For whoever picks it up:* a `.github/workflows` job on every push to `next`
and every PR, running `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
A second check — failing when a migration exists on the branch but not in the
deployed schema — would have caught the item at the top of this file, but
needs a read-only Neon connection string in CI, so ask first.

### ☐ Eight long-standing warnings in the map file

A "linter" flags suspicious patterns — not bugs yet, but the kind of thing
that becomes one. There are 8 in the big map file, and they predate this
year's work. The count was deliberately held flat through five refactors so it
couldn't creep up, but nobody has cleared them.

*For whoever picks it up:* `npx eslint components/viz/orbital/OrbitalMap.tsx`
reports 10 problems (8 errors, 2 warnings) — **treat that as the baseline and
do not let it grow.** Mostly `react-hooks/refs` and one
`react-hooks/set-state-in-effect`. Real smells in a 3,600-line component with
54 refs. Best done alongside the runtime extraction below, since several are
the frame loop reaching into render.

## 🔵 Finishing the engine split

The map is now six separable engines ([ENGINES.md](ENGINES.md)). These four
pieces were left behind on purpose, each recorded there with its reason. None
is urgent; all make the next change easier.

### ☐ Camera: deciding *what to look at* still lives in the map

The camera engine knows how to move. Deciding *which* unit to focus and what
to frame around it still sits in the map file, because that decision needs to
know the shape of the company.

*For whoever picks it up:* `enterFocus`, `leaveFocus`, `focusFromBreadcrumb`
and the pending-camera effect. Thin already, and they call the engine for
every number. It is a layout question wearing camera clothes — do it with the
layout work, not on its own.

### ☐ Signal: the hover and detail cards still live in the map

About 310 lines of card UI. Presentational, so they move with the component's
other chrome rather than alone.

*For whoever picks it up:* `OrbitalUnitCard`, `OrbitalHoverCard`, `Meter`.

### ☐ Runtime: the drawing loop

The largest remaining knot — a single function of about 270 lines that runs on
every animation frame and touches 33 different pieces of state.

**It should stay whole.** One loop reading one object is fast; six separate
passes are not, and on a five-year-old iPad that difference is the whole
product. The goal is to give it a tidy object to read, not to break it up.

*For whoever picks it up:* the frame loop, `hitTest`, `buildTargets`.
ENGINES.md § *The knot, stated plainly* has the shape to aim for.

### ☐ About 395 lines of styling at the bottom of the map file

Mechanical. Worth doing *after* the hooks above have taken their UI with them,
so it can be split per engine instead of moved in one lump.

*For whoever picks it up:* the `S` object in `OrbitalMap.tsx`.

---

## 🟣 Bigger pieces

### ⏸ You can rearrange a company, but you can't build one

**This is the biggest piece of unrealised value in the repo.**

The real map lets you move your company around — drag a team somewhere else,
merge two, change who reports to whom. What it *cannot* do is let you create
one: you can't draw a new team into existence and watch the org grow.

That ability does exist — but only in a lab prototype, built with different
drawing technology, so the real map cannot use a line of it. Two
implementations of the same idea that can't talk to each other.

Joining them is what turns "grow your org one node at a time" from a demo into
something a customer can touch.

Parked rather than open because it is about a week of work and wants a
decision first about what "create" should mean on a real company's data.

*For whoever picks it up:* port `app/lab/grow/GrowLab.tsx` (3,320 lines of
SVG) into `lib/map/growth/` as a headless hook the Konva map consumes, then
retire the duplicate. `drop.ts` is the shape its drops should land in. See
ENGINES.md § Growth and [UNIFIED-ORBITAL.md](UNIFIED-ORBITAL.md).

### ⏸ Every task on the map is invented

There is no Jira, WorkBoard or tracker connection. Every piece of work shown
on a person is made up by us, and the interface says so on each panel.

Integrations are explicitly later. **This is a marker, not a task** — it is
here so nobody forgets and builds something that quietly assumes the work data
is real.

*For whoever picks it up:* `lib/mock/personTasks.ts` is the only source.

---

## Recently done

*2026-09-24/25 — the six-engine split. Keep this short; the git log is the
real record.*

- ☑ Repo reconciled: 23 branches → 2 (`main`, `next`), every retired branch
  kept as a tag — "Make the docs tell the truth about two branches and one map"
- ☑ Canvas and Radial maps retired; Orbital is the only map — "Retire the two
  alternate maps, so there is one map to make excellent"
- ☑ Six engines named, with a test that enforces the import rule — "Name the
  six engines, and make a test hold the line between them"
- ☑ Camera · Basket · Work · Signal · Growth extracted, then Layout moved —
  "Give every engine its own directory — the split is finished"
- ☑ Four stages (`lab` → `next` → `release` → `main`), the lab pages gated out
  of production, and every seeder stopped from writing to a hosted database —
  "Four stages, so experiments stop leaking into production"
- ☑ The two grow experiments moved out of the front room (they were duplicate
  aliases of pages already under `/lab`, so they were simply deleted)
- ☑ Four stages runnable side by side on their own ports — "Run any two
  stages at once, on their own ports"
- ☑ README rewritten from `create-next-app` boilerplate; `puppeteer-core`,
  a dead screenshot script and five screenshots of a deleted map removed —
  "Clear out what nobody reads, and fix the front door"
