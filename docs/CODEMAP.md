# Codebase map

Find the file (and region) that owns your concern, read **only** that, then `grep -n` the symbol and `Read` with `offset`/`limit`. Line numbers drift — treat them as "jump near here," and re-grep to confirm. Whole-file reads are occasionally right, but justify it from this map first.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 · Drizzle ORM over Postgres (`postgres.js`) · Clerk auth (dev-auth bypass locally) · D3 (`d3-hierarchy/shape/zoom/selection/transition`) + SVG for the shipped viz · Konva + react-konva for the v2 canvas map (see [V2.md](V2.md)) · SheetJS + Zod for import. Deployed on Vercel + Neon.

## "Which file do I touch?" — by concern

| I'm working on… | Go to |
|---|---|
| **v2 canvas map (direction, staged plan, architecture impact)** | **[V2.md](V2.md)** — read before touching the viz |
| v2 canvas feel study | `app/lab/canvas/` (`page.tsx` shell + `CanvasMap.tsx` + generated `demoMap.ts`) |
| Greg's original prototype (the v2 trigger) | `docs/reference/greg-preview-v1.html` — see `docs/reference/README.md` |
| The radial visualization (anything on `/org`) | `components/viz/RadialOrg.tsx` — **see region table below** |
| Color palettes / themes | `lib/theme.ts` (palette IDs + accent) **and** `app/globals.css` (the CSS-var blocks per palette). Adding a palette = both files. |
| Analytics math (cost/ROI, gaps, allocation) | `lib/analytics/{rollup,gaps,allocation}.ts` — pure, client-safe, unit-testable |
| Org-tree / allocation helpers (indexes, ancestry, utilization) | `lib/org/model.ts` |
| DB schema / tables / enums | `lib/db/schema.ts` (`workspaces`, `memberships`, `people`, `orgUnits`, `assignments`) |
| DB connection / Drizzle client | `lib/db/client.ts`, `lib/db/orm.ts` |
| Reading data (server) | `lib/data/queries.ts` (`getOrgSnapshot`, `getPeople`, `getOrgUnits`, `getPerson`, `getOrgUnit`) |
| Mutations (server actions) | `lib/data/actions.ts` (create/update/delete person·unit·assignment, `moveOrgUnit`, `moveAssignment`, `loadDemoOrg`) |
| CSV/Excel import | `lib/data/import.ts` (commit) + `components/import/ImportWizard.tsx` (UI) + test `lib/data/__tests__/import.integration.mts` |
| Seed / demo data | `lib/db/seed.ts` (CLI `npm run db:seed`), `lib/data/demoSeed.ts` (in-app "Load demo org") |
| Auth / multi-tenant scoping | `lib/auth/workspace.ts` (`requireWorkspace`, `assertSameWorkspace`), `lib/auth/currentUser.ts` (Clerk vs dev-auth) |
| Form/action validation | `lib/validation.ts` (Zod schemas) |
| People / Teams CRUD pages | `components/people/PeopleManager.tsx`, `components/teams/TeamsManager.tsx` (pages are thin: `app/(app)/{people,teams}/page.tsx`) |
| Routing / auth middleware | `proxy.ts` (Next 16 — **not** `middleware.ts`) |
| App shell / layout / empty-org screen | `app/(app)/layout.tsx`, `app/(app)/org/page.tsx`, `app/(app)/{error,not-found}.tsx` |
| Onboarding banner, palette switcher | `components/OnboardingBanner.tsx`, `components/PaletteSwitcher.tsx` |

## `components/viz/RadialOrg.tsx` region guide (~1400 lines)
One client component. Jump to the region; don't read top-to-bottom.

| Region | ~Lines | What's there |
|---|---|---|
| Imports, `OverlayType` / `NodeDatum` types, geometry consts + `pointRadial`/`arcPath` | 1–65 | Layout constants (`WIDTH/HEIGHT/INNER_RADIUS/DROP_RADIUS`), pure SVG-math helpers |
| Component props + scenario state (`moves`, `effAssignments`) | 67–99 | What-if overlay over assignments |
| Derived indexes & analytics memos | 101–122 | `unitsById`, `peopleById`, `childByParent`, `asgByUnit`, `overAlloc`, `allocByPerson`, `rollupMap`, `gapsMap`, `orgSummary` |
| Focus state (drill-down) | 124–138 | `defaultFocusId`, `focusId`, `selectedPersonKey`, `showPanel` |
| Zoom state + handlers | 140–191 | `d3-zoom` setup, scale extent `[0.3,5]`, dblclick disabled, zoom in/out/reset |
| Drag state | 193–204 | pointer-drag reassignment refs |
| Semantic-zoom (LOD) computation | 206–339 | `DETAIL_START/FULL`, `detailOpacity`, `zoomFocusTeamId`, **bloom sets** `detailMembers` / `detailSubTeams` / `detail2Members` |
| Node/link layout | 213–264 | `hierarchy`/`tree` radial layout → `nodes`, `links` |
| Focus/move/scenario handlers | 426–470 | `focusOn`, `performMove`, `applyScenario`, `discardScenario`, `toggleScenario` |
| Pointer/drag handlers | 472–538 | `clientToLocal`, `beginMemberPointer`, `onSvgPointerMove`, `onSvgPointerUp` |
| **Main JSX return** | 540–955 | `<SummaryBar>`, breadcrumb, scenario controls, `<svg>` defs (gradients/glow/heat), `nodes.map`, the 3 bloom render blocks, drag ghost, zoom controls, detail `<aside>` |
| `onUnitClick` | 957–973 | two-phase center-click (reset zoom → navigate to parent) |
| Overlay prop builder | 985–1043 | `getOverlayProps` + `NodeOverlay` type (per-node dim/badge/heat) |
| Presentational components | 1045–1410 | `ContextSatellite`, `RadarNode` (the node art), `UnitPanel`, `PersonPanel`, `Row`, `OVERLAY_OPTIONS`, `SummaryBar`, `Metric` |

## Conventions worth knowing before you edit
- **Tenancy:** every data read/write goes through `requireWorkspace()` and is scoped by `workspace_id`. Never query unscoped.
- **Analytics are pure functions** in `lib/analytics/*` (no React, no DB) — add a Vitest fixture when you change the math.
- **Tailwind v4 gotcha:** CSS vars referenced only from JS/SVG get tree-shaken by Lightning CSS → blanked gradients. Keep palette tokens inside `@theme static` in `globals.css`. (See memory `zenhance-tailwind-css-var-pruning`.)
- **Run locally:** `brew services start postgresql@14` → `npm run dev` (:3000, dev-auth auto-signs in). `npm run db:seed` to reset to the demo org.
