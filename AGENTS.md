# Zenhance — agent orientation

Multi-tenant SaaS, live in production on Vercel (Neon Postgres + Clerk auth). **`main` deploys to production on push.**

## What we're building *(subject to revision)*
1. **The best way for people in a company to see and work with their company** — restructuring, sandboxing, cashflow, impact flow, how work ties to strategy, the big picture. Almost gamelike in its simplicity and interactivity: real-time views of where people are, what work is happening, reporting lines, delivery progress.
2. **User experience is paramount.** Every interaction should land as *"why didn't we think of this?"* — so obvious it's uncanny.
3. **Integrations come later, and will be crucial** — payroll, Jira, WorkBoard, document control, whatever customers run on.
4. **AI will play a role.** We don't know what yet.

## Who's involved
- **Nate** — co-founder and CEO, focused more on the back end.
- **Greg** — co-founder, leads product and visualisation: how it looks, feels and behaves. Nate generally defers to Greg on this.
- **Agents** — Greg works with Claude and ChatGPT; Nate works with Claude (and possibly others). Several agents may be committing to this repo in parallel.
- **Neither Greg nor Nate codes.** That hands agents a large advantage, and it has to be held responsibly — see rule 4. Greg and Nate settle most things in conversation; the git log is how they step back.

## Lines that never move
Speed comes first (rule 2), but never across these.
- **A company's data is theirs, and nobody else can see it — not other companies, and not us.** The aim is for it to live encrypted on the customer's own systems. We may one day ask for abstractions, but never anything that ties a datapoint to a person or a decision. *This is the principle, not yet the build: org data currently sits in Zenhance's own database. Don't build anything that makes it harder to get there.*
- **Demo mode uses invented data only.** No real people in fixtures, seeds, screenshots or commits.
- **`main` is production, and only Greg or Nate put work there.** It deploys straight to production on push, so it shows customers only what is ready. Agents never merge to `main`. Work goes to **`next`** (see *Two branches*).
- **Nothing irreversible without a human's yes** — rewriting history on `main` or `next`, deleting data, changing the production database.

## How agents work here
1. **Deliver great experiences.**
2. **For now, a great demonstrable experience comes *slightly* ahead of code fidelity.** We're refining the idea with potential customers, and what they touch should solve problems, save time, and delight. Rapid innovation and refinement is the point: the UI must be slick and fast, and the code shaped so it can change quickly.
3. **Critique and advance each other's work.** Finding and fixing bugs, QA, test-driven development, concerns about UI or interaction — all in scope, whoever wrote the code.
4. **Be truthful and plain about what you did, whenever asked.** You don't need to narrate everything, but you must be able to explain any action at any time, in plain English, without spin. This matters most in QA: say what you actually verified, what you didn't, and what you're unsure of.
5. **Collaborate, don't fight.** Respectful disagreement about how code is written is expected. When one needs a decision, bring Greg a plain-English case: the options, the trade-offs, and your recommendation.

### Two branches
- **`main` is production.** What customers see. Agents never push to it.
- **`next` is the trunk.** Everything in progress lives here. Branch from `next`, squash-merge back to `next`. Vercel builds it as a *preview*, never as production.
- **Landing `next` on `main` is a release, and a human decides when.** Not an agent, and not as a side effect of finishing a story.
- **Nothing is ever lost.** Retired branches live on as `archive/*` tags — `git tag -l 'archive/*'`, then `git show <tag>` or `git checkout -b recover <tag>`. Clean up freely; the history is there.

### Working alongside other agents
- **One repo, one trunk, no agent's private corner.** Greg (2026-09-24): *"There shouldn't be differing branches for Codex or Claude — I want you to read and edit as much Codex-written stuff as Codex does yours."* So: **no `codex/` or `claude/` branch prefixes.** Branches are named for the work (`<feature>-<slug>`), whoever does it, and any agent may read, edit, critique or fix any file regardless of who wrote it.
- **The repo is the only shared channel.** Agents can't see each other's chats or private memory. Decisions and their reasons go in the docs under *Where things live* — including approaches tried and abandoned, so nobody spends a day rediscovering a dead end. Commit messages say *why*, not just what.
- **Noticed something you shouldn't fix here? Write it in [docs/TASKS.md](docs/TASKS.md).** Fixing an unrelated thing inside someone else's change hides it; leaving it in a chat window loses it. Claim a task by marking it `▶` with your name **and pushing that** before you start, so two agents don't do the same work.
- **Write for Greg and Nate first.** They don't code, and a task list in shorthand is a task list only you can read. Every entry in TASKS.md opens with a plain-English paragraph — what it is, why it matters, what is being asked — before any file path or symbol. *If you can't write that part, you don't understand the task well enough yet.* The same goes for a commit's first line and for anything you bring them for a decision.
- **`git fetch` before starting, and again before any merge or push.** `next` moves underneath you.
- **An unfamiliar commit is someone's deliberate work.** Read it before you build over it or revert it.
- **Don't work in a private worktree.** Three stale worktrees on 2026-09-24 held 46 uncommitted files between them, invisible to everyone else. Work in the repo, commit often, push to `next`.

### Customer feedback
- Greg and Nate relay what prospects say. It's logged in [docs/FEEDBACK.md](docs/FEEDBACK.md); anything that changes what we build also gets a *Customer signal* write-up in the roadmap.
- **Every 48 hours, ask for it.** At the start of a session, check *Last asked* in `docs/FEEDBACK.md`. If it's more than 48 hours ago, ask the person you're working with for new feedback, log what they tell you, and update the date. Agents have no clock between sessions — the date in that file is the timer.

## Performance and testing bar
- **It must run well on an entry-level iPad from five years ago, and on a Lenovo laptop IT hasn't upgraded in ten.** Rich visuals and interactions are the enhancement, never the requirement.
- **Graceful fallback.** The core experience works with effects turned down or off; richer effects arrive only where the device can carry them. Respect `prefers-reduced-motion`.
- **Touch is a first-class input.** Anything you can reach by hovering must also be reachable by tapping.
- **Check every change to the map on both companies** — Sparrow Jam (10 people) and Digital Tailoring (45). A fix for one has broken the other more than once. *(**Northwind**, ~2,560 invented people over eleven rungs, is back in the local development database since 2026-09-23 — `npm run db:northwind`. It was retired on 2026-09-20 to keep the database light, which held while the work was pure geometry and stopped holding once the map had to be navigated at scale. Seed it locally and look at it; the seeder refuses any database that is not on this machine, and there is no card for it on the import page. The same shape is still what the pure scale tests use, `lib/map/layout/__tests__/fixtures/deepOrg.ts`.)*

## Work with the least context needed
This is a small repo, but `components/viz/orbital/OrbitalMap.tsx` alone is ~3,600 lines. **Don't read whole files or scan the tree by default.**

**Start from the engine.** Since 2026-09-24 the map is seven directories under `lib/map/` — layout, camera, runtime, growth, signal, work, basket — each pure and tested on its own. If your change belongs to one of them, that directory plus its tests is usually all the context you need. [docs/ENGINES.md](docs/ENGINES.md) says which owns what.

1. **Start at [docs/CODEMAP.md](docs/CODEMAP.md)** — it tells you which file owns a given concern. Read only the section the map points you to.
2. **Locate symbols with `grep -n`** (function/const/type name), then `Read` with `offset`/`limit` around the hit. Reach for a full-file read only when the map says the change is genuinely cross-cutting.
3. A whole-file or whole-tree read is sometimes correct — but make it a deliberate choice the map justifies, not a reflex.

## Where things live
- **What to build next:** [docs/ROADMAP.md](docs/ROADMAP.md) — start at **▶ Next build**. Features → Stories. **Analytics is design-first: discuss before coding.**
- **Loose ends and open decisions:** [docs/TASKS.md](docs/TASKS.md) — the shared to-do list. Check it at the start of a session; add to it whenever you notice something you shouldn't fix silently inside someone else's change.
- **Product/design *why* (personas, formal-vs-delivery, analytics design language, packaging):** [docs/PRODUCT.md](docs/PRODUCT.md). Read once; don't re-derive it in chat.
- **Codebase map:** [docs/CODEMAP.md](docs/CODEMAP.md).
- **The six engines** (layout · growth · work · signal · camera · basket), what each owns, and the import rule a test enforces: **[docs/ENGINES.md](docs/ENGINES.md)**. Read it before moving code between them or adding a file to `lib/map/`.
- **Design sandboxes (feel studies) + archive convention:** [docs/LAB.md](docs/LAB.md).
- **Customer feedback:** [docs/FEEDBACK.md](docs/FEEDBACK.md).
- **Durable facts** (running locally, gotchas) belong in `docs/`, where every agent can read them — not in any one agent's private memory. *Some still live only in Nate's Claude memory (`~/.claude/projects/-Users-natetgreat-zenhance/memory/`); Nate's agent should move them into `docs/`.*

## House rules
- **Branch per story** (`<feature>-<slug>`, no agent prefix), squash-merge to `next`. Patch-bump `package.json` per merge; minor bump when a Feature completes.
- **Make every commit on `next` a step someone could go back to.** Greg and Nate use the git log to step back, so one coherent change per commit, with a first line they can read in plain English.
- **Delete a branch once it's merged or abandoned** — locally and on the remote. Don't delete a branch you didn't create unless it's merged, or its owner has said it's finished.
- **Verification:** neither Greg nor Nate can QA code, so agents check their own work — including looking at UI changes in a browser on Sparrow Jam and Digital Tailoring, plus running the large-org layout fixture where relevant. Cheap checks (`npx tsc --noEmit`, tests) still come first.
- Commit/push only when asked.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
