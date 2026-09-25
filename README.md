# Zenhance

See your company as it actually works — who's where, what's being built, how
the work connects — on a map you can rearrange and reason about.

Multi-tenant SaaS. Next.js 16 · TypeScript · Postgres (Neon) · Clerk auth ·
Konva for the map. Deployed on Vercel.

---

## If you're Greg or Nate

You don't need any of the files below. Three documents cover everything:

| | |
|---|---|
| **[docs/TASKS.md](docs/TASKS.md)** | What's outstanding, and what's waiting on a decision from you. Every item in plain English first. |
| **[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)** | The four stages work moves through, and what reaches customers. |
| **[docs/ROADMAP.md](docs/ROADMAP.md)** | What we're building next. |

**The one rule that matters:** `main` is production and deploys the moment
anything lands on it. Nothing gets there except by you or Nate saying so.

---

## If you're an agent

Read **[AGENTS.md](AGENTS.md)** first — it is the charter, and it takes
precedence over anything here.

Then, in order of how often you'll want them:

| | |
|---|---|
| **[docs/CODEMAP.md](docs/CODEMAP.md)** | Which file owns a given concern. Start here; don't scan the tree. |
| **[docs/ENGINES.md](docs/ENGINES.md)** | The map is six engines under `lib/map/`. Which owns what, and the import rule a test enforces. |
| **[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)** | lab → next → release → main, and how to run two at once. |
| **[docs/TASKS.md](docs/TASKS.md)** | Loose ends. Add to it rather than fixing unrelated things in passing. |

**Ask which stage before you start.** Lab, next, or release — it decides what
the work may be and who sees it.

---

## Running it

```bash
brew services start postgresql@14     # once
cp .env.example .env.local            # once — keep DATABASE_URL local
npm install
npm run db:seed                       # demo org
npm run db:companies                  # Sparrow Jam + Digital Tailoring
npm run dev                           # http://localhost:3000
```

Locally you're signed in automatically (`DEV_AUTH=1`); no Clerk account
needed. The map is at `/org`.

### Two stages side by side

```bash
npm run stage              # what's checked out, on what port, what's unsaved
npm run stage lab          # lab on :3001
npm run stage next         # next on :3002
npm run stage:clean        # remove the extra checkouts
```

Each is a git worktree sharing this history — about 600MB of `node_modules`
each, so clean up when you're done.

### Everything else

```bash
npm run test               # 580 tests, ~3s
npx tsc --noEmit           # typecheck
npm run build              # production build
npm run db:northwind       # ~2,560-person company, local database only
```

**Seeders refuse any database that isn't on your own machine.** They write
invented people, and pointed at a hosted database that overwrites real ones
with no undo.

---

## How the code is laid out

```
app/              routes — (app) is the product, (marketing) the public site,
                  lab/ the experiments (404 in production)
components/viz/   the map's renderer — OrbitalMap.tsx and its painters
lib/map/          the six engines: layout · camera · growth · signal ·
                  work · basket, plus runtime. Pure, tested, no React
lib/data/         queries and server actions, all workspace-scoped
lib/db/           schema, migrations, seeders
docs/             the documents above
```

Every engine under `lib/map/` is pure — no React, no Konva, no database — so
a wrong fit or a wrong drop fails in a test in milliseconds instead of needing
a browser and a squint. That property is enforced by
`lib/__tests__/engineBoundaries.test.ts`, which also refuses any new file
there until someone says which engine owns it.
