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
| `canvas` | **active** | v2 canvas map feel study (Konva). Proved the four-rung zoom ladder (Value streams→Teams→People→Roles), free-form drag, layer toggles, search-with-halo, and zones. Direction + staged plan: [V2.md](V2.md). **Two files, not one** — Konva needs `ssr: false`, and Next requires that dynamic import to live in a Client Component, so `page.tsx` is a shell around `CanvasMap.tsx`. |
| `analytics` | **archived** | Graduated to prod (2026-06-16) as `lib/analytics/findings.ts` + `FindingsRail` in `RadialOrg.tsx`. Design rationale: `PRODUCT.md` § Analytics design language. Feel: ambient = presence dots (category colour, equal weight); focus = spotlight + Signal→Narrative. |
