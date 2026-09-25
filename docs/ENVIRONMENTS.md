# Where to experiment, and what reaches customers

```
  lab  ─────▶  next  ─────▶  release  ─────▶  main
  wild         build it      last stop        live
  west         for real      before live
```

**Only `main` is for the public.** Everything else runs on a real URL, and
none of them are for online users.

**Moving between stages needs a human's yes. That is the whole gate** — not a
checklist, not a robot. Greg or Nate says "promote it", and it moves.

---

## Before starting anything, ask which stage

**The first question of any piece of work is: *lab, next, or release?***

Ask it out loud before writing code. It decides what the work is allowed to
be, what bar it has to clear, and who will see it. Guessing wrong means doing
it twice.

- *Trying an idea, unsure if it feels right* → **lab**
- *Building something we've decided on* → **next**
- *Fixing something already staged to go live* → **release**

If the answer isn't obvious from what's being asked, ask. A one-line question
is cheaper than a branch in the wrong place.

---

## The four stages

### `lab` — the wild west
Where an idea gets tried. Break it freely; nobody is watching. Half-finished
is normal, tests are optional, ugly is fine if ugly is faster.

**The lab answers one question: does this feel right?** Not "is this built
well" — asking that too early kills ideas that deserved a chance.

### `next` — build it for real
An idea that earned its place gets built properly: typed, tested, working on
both demo companies, living inside the engines rather than beside them.

This is the trunk. Stories branch from here and squash-merge back.

**Lab code isn't promoted by copy-paste.** What crosses is the *idea*; what
lands is an implementation that belongs here. Usually a rewrite, and that
isn't waste — the lab version was answering a different question.

### `release` — last stop before live
A frozen candidate. **Assume everything here is going to production**, so it
gets looked at as if it already were.

Its real job: **migrations get rehearsed here before production.** Apply to
`release`, watch it work, then apply to production. The `0005` outage in
ROADMAP.md happened because there was nowhere to practise.

Only fixes land here. New work goes to `next` and waits for the next
promotion, or this stops being a last stop and becomes a second trunk.

### `main` — live
What customers see. Pushing here deploys automatically.

**Only Greg or Nate, only from `release`.** Never an agent, never directly,
never as a side effect of finishing something.

---

## Who can reach what

| Stage | URL | Who sees it |
|---|---|---|
| `main` | the real domain | Everyone. This is the product. |
| `release`, `next`, `lab` | Vercel preview URLs | **Not for online users** |

Two things are done in code:

- **Search engines are told to stay away** from every non-production stage
  (`robots: noindex, nofollow, noarchive` in `app/layout.tsx`), so a
  half-built deployment never appears in results beside the real product.
- **The lab pages 404 in production** (`app/lab/layout.tsx`), so a customer
  can't find an experiment by guessing a URL. Verified: 404 in a production
  build, 200 in a preview one.

**What is not done, and needs a dashboard:** none of that stops someone who
*has* a preview link from opening it. The fix is **Vercel Deployment
Protection** — set it to require Vercel authentication for all preview
deployments, so only people on the team can open one. One setting, and it is
the only thing that actually makes previews private.

*Until that is on, treat preview URLs as semi-public: fine for invented demo
companies, not somewhere to point a customer's real data.*

---

## Databases

Everything goes through one `DATABASE_URL`, and no code distinguishes a
production database from a demo one, so **a deployment writes to whatever it
is handed.**

| Stage | Should point at |
|---|---|
| `main` | Production |
| `release` | A Neon **branch** — production's shape and volume, none of its consequences |
| `next`, `lab`, story previews | A demo database. Never production. |
| local | Postgres on your own machine |

**Two things for Greg or Nate, in dashboards:**

1. **Check what preview deployments use today.** If Vercel's preview variables
   were never set separately, every preview has been reading and writing
   **production**. Five minutes settles it, and nothing else on this page
   matters as much.
2. **Give `release` its own Neon branch.** Until it has one, it is a rehearsal
   in costume — it won't catch the volume-and-migration problems it exists
   for.

**Already guarded:** every seeder refuses a database that isn't on your own
machine (`requireLocalDatabase` in `lib/env.ts`). A seeder writes invented
people over real ones with no undo, and only `northwind` had that guard before
2026-09-25.

---

## Starting work

**An idea, feel unproven** → branch from `lab`, merge back to `lab`. Study goes
under `app/lab/<name>/`, verdict in LAB.md.

**A known thing to build** → branch from `next` (`<feature>-<slug>`, no agent
prefix), squash-merge back to `next`.

**A fix for something staged** → branch from `release`, merge to `release`,
and **get it back onto `next` too** — a fix that only exists on `release`
disappears at the next promotion.

---

## A note on what agents owe regardless

Promotion is a human's call. But the verification in AGENTS.md — `tsc`, the
tests, looking at it in a browser on both companies — is what an agent owes on
*any* change, at any stage above `lab`. That isn't a gate; it's the job.

The difference: nobody needs to see a checklist before saying "promote it".
They need to be able to trust that the agent did its work.
