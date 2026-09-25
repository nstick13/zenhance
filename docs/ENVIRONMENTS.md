# Where to experiment, and what reaches customers

Four stages. Work moves forward one at a time, and each step has a bar it has
to clear. Nothing skips.

```
  lab  ─────▶  next  ─────▶  release  ─────▶  main
  wild         build it      dress            live
  west         for real      rehearsal
```

| Stage | What it's for | Who can break it | Where it runs |
|---|---|---|---|
| **`lab`** | Trying an idea. Does this *feel* right? | Anyone, anytime | Preview URL, demo data |
| **`next`** | Building a proven idea properly | Nobody knowingly | Preview URL, demo data |
| **`release`** | Dress rehearsal for going live | Nobody | Preview URL, **production-shaped data** |
| **`main`** | What customers see | — | zenhance.app, real data |

## What each one is

### `lab` — the wild west

Where an idea gets tried. Break it freely; nobody is watching. Half-finished
is the normal state, tests are optional, and code here is allowed to be ugly
if ugly is faster.

**The lab exists to answer one question: does this feel right?** Not "is this
built well" — that comes next, and asking it too early kills ideas that
deserved a chance.

The grow flow lives here. So does anything with a feel worth arguing about
before anyone commits to building it.

### `next` — build it for real

An idea that earned its place in the lab gets built properly here: typed,
tested, working on both demo companies, and living inside the engines rather
than beside them.

This is the trunk. Every story branches from here and squash-merges back.

**Code doesn't get promoted from `lab` by copy-paste.** What crosses is the
*idea*; what lands is an implementation that meets this stage's bar. In
practice that usually means a rewrite, and that is not waste — the lab version
was answering a different question. See LAB.md.

### `release` — the dress rehearsal

**This is the stage we were missing.** A frozen candidate, running as close to
the real thing as we can make it, so that the only difference between it and
production is who is looking.

Its job is to catch what preview builds cannot: a migration applied in the
wrong order, a query that is fine on ten people and slow on two thousand, an
environment variable nobody set. Every one of those has bitten us or nearly
has.

**Migrations get rehearsed here first.** Apply to `release`, watch it work,
then apply to production. The `0005` outage in ROADMAP.md happened because
there was nowhere to practise.

Only fixes land on `release`. New work goes to `next` and waits for the next
promotion — otherwise it stops being a rehearsal and becomes another trunk.

### `main` — live

What customers see. Vercel deploys it automatically on push.

**Only Greg or Nate put anything here, and only from `release`.** Never an
agent, never directly, never as a side effect of finishing something.

## The bars between stages

### `lab` → `next`
- A human — normally Greg — has looked at it and said the feel is right.
- Somebody can say in a sentence what the idea *is*, separate from how the
  prototype happened to do it.

### `next` → `release`
- `npx tsc --noEmit` clean
- `npx vitest run` all passing
- `npm run build` succeeds
- Looked at in a browser on **both** demo companies
- **Every migration on the branch is already applied to the `release`
  database** — this is the step that exists to stop another `0005`
- `docs/TASKS.md` has nothing left under *Blocking a release*

### `release` → `main`
- The rehearsal has actually been used, not just deployed
- Every migration applied to **production**, before the push, not after
- Greg or Nate says go

## The lab pages

Separate from the `lab` branch, and worth not confusing: `app/lab/*` holds
feel-studies that ship *inside every build*.

**They are reachable everywhere except production**, enforced in
`app/lab/layout.tsx` via `labPagesVisible()` in `lib/env.ts`. So anyone can
open a preview and look at an experiment, and no customer can find one by
guessing a URL.

Gating beats deleting: nothing has to be stripped out before a release, so
nobody has to remember to strip it. Tests in `lib/__tests__/env.test.ts`.

*Two things called lab, doing different jobs: the `lab` **branch** is where
raw work happens; the `/lab` **pages** are where finished experiments can be
looked at from any stage.*

## Databases — the part that needs deciding

Everything the app does with data goes through one `DATABASE_URL`. There is
no code that knows a production database from a demo one, which means **a
preview deployment writes to whatever Vercel hands it.**

Unless preview environment variables were set separately in Vercel, that is
the production database. Nobody has confirmed either way, and it is worth
five minutes in the dashboard.

What it should be:

| Stage | Database |
|---|---|
| `main` | Production Neon |
| `release` | A Neon **branch** — a copy of production's shape and volume, with none of its consequences |
| `next`, `lab`, story previews | A demo database. Never production. |
| local | Postgres on your own machine |

**Decision needed from Greg or Nate:** creating that Neon branch for `release`
costs something and is not an agent's call. Until it exists, `release` is a
rehearsal in costume — better than nothing, but it will not catch the
volume-and-migration problems it is there for.

### What is guarded already

Every seeder now refuses to run against a database that is not on your own
machine — `db:seed`, `db:companies`, `db:scale`, `db:northwind`, via
`requireLocalDatabase()` in `lib/env.ts`.

That matters because a seeder fills a workspace with invented people. Pointed
at production it would write Sparrow Jam over a customer's org, and there is
no undo. Only `northwind` had this guard before 2026-09-25; the other three
were equally capable of the damage.

## Starting a piece of work

**A new idea, feel unproven** → branch from `lab`, merge back to `lab`.
Put the study under `app/lab/<name>/` and record the verdict in LAB.md.

**A known thing to build** → branch from `next` (`<feature>-<slug>`, no agent
prefix), squash-merge back to `next`.

**A fix for something already staged** → branch from `release`, merge to
`release`, and **cherry-pick or re-merge it back to `next`** so the trunk
doesn't lose it. A fix that only exists on `release` disappears at the next
promotion.

## What this does not do

**Nothing is automated yet.** No CI checks these bars — they hold because
people follow them. `docs/TASKS.md` has the CI job that would enforce the
`next → release` bar mechanically; until that exists, the bars are honour
system, and the honour is mostly an agent's.
