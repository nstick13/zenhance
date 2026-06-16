# Zenhance — agent orientation

Zenhance visualizes the **delivery** org (cross-functional teams that ship) as a radial D3+SVG map, with analytics the structure makes possible. Multi-tenant SaaS. Live in production on Vercel (Neon Postgres + Clerk auth).

## Work with the least context needed
This is a small repo, but `components/viz/RadialOrg.tsx` alone is ~1400 lines. **Don't read whole files or scan the tree by default.**

1. **Start at [docs/CODEMAP.md](docs/CODEMAP.md)** — it tells you which file (and which region of `RadialOrg.tsx`) owns a given concern. Read only the section the map points you to.
2. **Locate symbols with `grep -n`** (function/const/type name), then `Read` with `offset`/`limit` around the hit. Reach for a full-file read only when the map says the change is genuinely cross-cutting.
3. A whole-file or whole-tree read is sometimes correct — but make it a deliberate choice the map justifies, not a reflex.

## Where things live
- **What to build next:** [docs/ROADMAP.md](docs/ROADMAP.md) — start at **▶ Next build**. Features → Stories. **Analytics is design-first: discuss before coding.**
- **Product/design *why* (personas, formal-vs-delivery, analytics design language, packaging):** [docs/PRODUCT.md](docs/PRODUCT.md). Read once; don't re-derive it in chat.
- **Codebase map:** [docs/CODEMAP.md](docs/CODEMAP.md).
- **Design sandboxes (feel studies) + archive convention:** [docs/LAB.md](docs/LAB.md).
- **Durable facts** (run locally, gotchas): agent memory index at `~/.claude/projects/-Users-natetgreat-zenhance/memory/MEMORY.md`.

## House rules
- **Branch per story** (`<feature>-<slug>`), squash-merge to `main`. Patch-bump `package.json` per merge; minor bump when a Feature completes.
- **Verification:** Nate eyeballs UI changes himself — don't burn tokens on preview screenshots. Cheap checks (`npx tsc --noEmit`, integration tests) are still worth running.
- Commit/push only when asked.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
