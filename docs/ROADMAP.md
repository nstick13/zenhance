# Zenhance roadmap

Organized as **Features → Stories**. This is the canonical roadmap (replaces the old M0–M8 milestone plan). For *how* the code is laid out, see [CODEMAP.md](CODEMAP.md).

> **Vision (Greg, co-founder):** "SimCity for a COO on an iPad." A delivery org you can zoom, pan, search, and rearrange like a living map — surfacing what the structure hides (over-allocation, gaps, cost/ROI).

## Status — as of 2026-06-16
- **Version 0.1.2**, deployed to **production** on Vercel.
- **Infra is fully live: Neon Postgres + Clerk auth + Vercel.** The old "create Clerk/Neon accounts" blocker is **resolved** — production deploy is no longer gated on Nate provisioning anything.
- **Foundations shipped (v1 core):** multi-tenant schema + auth scoping; People/Teams CRUD; CSV/Excel import; the radial D3+SVG viz with drill-down + person/team panels; drag-to-reassign + scenario mode; analytics overlays (allocation / gaps / cost-ROI) + summary bar; palette switcher (5 themes); zoom & pan (F1); multi-level group zoom + drag-in-zoom (F2).

---

## Feature: Analytics  🧭 *design-first*
> **Do not start coding these without a design pass first.** This whole feature gets a separate, non-coding discussion (the "what should the visualization reveal?" conversation). Stories below are seeds, not specs.

- **Search & filter** — *attempted as F3, scrapped 2026-06-16 pending rethink.* Search people/teams; narrow the view by attributes (e.g. utilization band). **Learnings to carry in:**
  - Dimming non-matches alone was **not legible**, especially for a touch/iPad glance. Matches need an *additive* highlight (halo/ring/spotlight), not just everyone-else-fades.
  - The originally-specced "active / on-hold" status filter **has no backing data** — see Data Model. Decide the data question before rebuilding this.
  - Open design Qs: fuzzy vs substring; how matches behave across zoom/bloom levels; whether filter narrows the *layout* (hide) or just *emphasis* (dim).
- **Burnout risk overlay** — schema already has `person.last_vacation_at`; combine with tenure for a risk heat/badge overlay (parallels the cost overlay pattern in `getOverlayProps`).
- **More viz stories — TBD.** The bigger "what analytics does the living structure unlock?" exploration lands here after the design chat.

---

## Feature: Data Model  🔜
> Foundational — several Analytics stories depend on these. Worth seeing in the demo org early.

- **User-defined / custom fields** — let a workspace add its own fields to people and/or units (beyond the fixed schema), and surface them in panels, filters, and import mapping. Touches `lib/db/schema.ts`, the import column-mapping, and the detail panels.
- **Sub-groups (teams-of-teams nesting)** — deeper hierarchy than the current group→team→members. *"Need to see this in the demo"* — extend `lib/db/seed.ts` / `demoSeed.ts` so the demo org actually shows multi-level nesting, then confirm the viz + zoom handle it.
- **Lifecycle status (active / on-hold)?** — the field the scrapped search filter assumed. Decide here whether units/people get a status concept (and whether it's a fixed enum or just a custom field via the story above).

---

## Feature: Functionality  🔜
> Interaction & polish that make it feel touch-native. Mostly self-contained viz/UX work.

- **Double-tap to center** — *(the original F2 that got dropped when F2 was redefined.)* Double-tap/click a node → smooth `d3-zoom` transition that centers + scales to fit its subtree. Note: dblclick is currently **disabled** in the zoom filter (`RadialOrg.tsx` ~line 153) — re-enabling there is the starting point. Complements single-click drill-down.
- **Animated transitions** — smooth position interpolation on drill-down and overlay switches (today they snap).
- **Scenario save / compare** — persist multiple what-if scenarios and diff them side-by-side (builds on the existing in-memory `moves` overlay).
- **Responsive panel + touch targets (iPad)** — detail `<aside>` → bottom sheet under `lg`; ≥44px touch targets; SummaryBar pills wrap; SVG fills viewport. *(folded in from old M6/F4.)*
- **Empty / error states** — audit `/people` & `/teams` empty states; verify `error.tsx` / `not-found.tsx`. *(old F5; quick.)*
- **"Mini Metro" theme** — light, flat, no-glow palette (Greg's "clean, minimal, calm"). Add to `lib/theme.ts` + the `@theme static` block in `globals.css`. *(old F6.)*

---

## Backlog  🅿️ *(post-v1, not committed)*
- **Edge-type layer toggles** — separate visibility for "reporting" vs "project assignment" edges (Greg's layer concept; needs edge-type modeling → relates to Data Model).
- **Workspace invites & roles** — Clerk Organizations already supports it; v2.
- **Live data connectors** — Jira / ADO / HRIS import; v2+.
- **Marketing landing page** — `app/(marketing)/`; build when the product is demo-ready.

---

## Working agreements
- **Branch per story** (`<feature>-<slug>`, e.g. `func-double-tap`), squash-merge to `main`. Patch-bump `package.json` per merge; minor bump (→ 0.2.0) when a Feature completes.
- **Deploy:** Vercel preview per branch push; promote to prod after a Feature lands or for a demo.
- **Verification:** Nate eyeballs UI himself — no preview-screenshot loops. `npx tsc --noEmit` + tests are the cheap gate.
- **Analytics work is gated on a design discussion** — don't code it cold.
