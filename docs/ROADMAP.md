# Zenhance roadmap

Organized as **Features → Stories**. This is the canonical roadmap (replaces the old M0–M8 milestone plan). For *how* the code is laid out, see [CODEMAP.md](CODEMAP.md).

> **Vision (Greg, co-founder):** "SimCity for a COO on an iPad." A delivery org you can zoom, pan, search, and rearrange like a living map — surfacing what the structure hides (over-allocation, gaps, cost/ROI).

## Status — as of 2026-08-25
- **Version 0.1.7.** Production on Vercel runs the radial/SVG viz; v2 canvas work has not shipped yet.
- **Infra is fully live: Neon Postgres + Clerk auth + Vercel.** The old "create Clerk/Neon accounts" blocker is **resolved** — production deploy is no longer gated on Nate provisioning anything.
- **Foundations shipped (v1 core):** multi-tenant schema + auth scoping; People/Teams CRUD; CSV/Excel import; the radial D3+SVG viz with drill-down + person/team panels; drag-to-reassign + scenario mode; analytics overlays (allocation / gaps / cost-ROI) + summary bar; palette switcher (5 themes); zoom & pan (F1); multi-level group zoom + drag-in-zoom (F2).
- **Marketing site shipped (2026-06-16):** public Home / Features / Pricing / About at https://zenhance.vercel.app (see Backlog).
- **Since then:** findings rail + ambient/focus overlay (v0.1.3), `reports_to` formal layer (v0.1.4), a ~45-person demo org (v0.1.5), and the **v2 canvas direction + Konva feel study** (v0.1.6–0.1.7).

---

## ▶ Next build (start here)

> **v2 — the canvas map.** Read **[V2.md](V2.md)** for the decisions, then
> **[V2-BUILD-PLAN.md](V2-BUILD-PLAN.md)** for the seven branch-sized stories with files, definition-of-done
> and traps. Start at **S1 `v2-map-core`** (S3 `v2-paper-shell` can run in parallel).
>
> The feel study is built and verified at `/lab/canvas`.

**Decisions taken 2026-08-25 (settled — don't re-open):**
- Canvas becomes `/org`. **Radial is retired to a layout command** (`tidyUp()`), not kept as a peer view.
- **The whole app moves to the light "paper" register** — this settles the *Mini Metro theme* story below.
  The 5 palettes become accents over a shared paper base.
- Groups (release trains) are **placeable nodes with a centroid fallback**.
- Sequencing: foundation first, but front-load the look so every intermediate state is demo-able.

### ✅ Shipped since this section was last written
- **Track 1 — Analytics "findings" UI** — shipped `3d1287c` (v0.1.3): `lib/analytics/findings.ts`
  (over-allocation + shared-person coupling) and the `FindingsRail` + ambient/focus overlay in `RadialOrg`.
  The `app/lab/analytics` sandbox is archived per LAB.md.
- **Track 2 — `reports_to` + formal layer** — shipped `2a9b835` (v0.1.4): `people.managerId` + migration,
  formal map mode, and a demo seed whose reporting lines deliberately diverge from delivery teams
  (`02b8a4a` extended it to ~45 people).
- *Still open from Track 2:* `employment_type`, `timezone` and a structured `role` — see **Data Model** below.

## Feature: Analytics  🧭 *design-first*
> **Do not start coding these without a design pass first.** This whole feature gets a separate, non-coding discussion (the "what should the visualization reveal?" conversation). Stories below are seeds, not specs.

- **Search & filter** — *attempted as F3, scrapped 2026-06-16 pending rethink.* Search people/teams; narrow the view by attributes (e.g. utilization band). **Learnings to carry in:**
  - Dimming non-matches alone was **not legible**, especially for a touch/iPad glance. Matches need an *additive* highlight (halo/ring/spotlight), not just everyone-else-fades.
  - The originally-specced "active / on-hold" status filter **has no backing data** — see Data Model. Decide the data question before rebuilding this.
  - Open design Qs: fuzzy vs substring; how matches behave across zoom/bloom levels; whether filter narrows the *layout* (hide) or just *emphasis* (dim).
- **Burnout risk overlay** — schema already has `person.last_vacation_at`; combine with tenure for a risk heat/badge overlay (parallels the cost overlay pattern in `getOverlayProps`).
- **Cross-cutting / shared roles** *(discuss in the Analytics chat)* — model and visualize people who support **across** the structure rather than sitting inside one team: e.g. someone covering security or compliance for an entire release train / "delivery group," or an IT function that serves many teams. Today the demo data treats people as members of specific teams; we need to represent a person whose support spans a whole group (or multiple groups) and decide how that reads in the radial map — a satellite around the group? an edge to every team they touch? a separate "function" layer? This ties directly into the multiple-allocation analytics (these people are *the* over-allocated, shared resources) and into the Data Model (sub-groups, edge types). Bring real examples (security/compliance/release-train support) to the discussion.
- **More viz stories — TBD.** The bigger "what analytics does the living structure unlock?" exploration lands here after the design chat.

---

## Feature: Data Model  🔜
> Foundational — several Analytics stories depend on these. Worth seeing in the demo org early.

### ⭐ Decision (2026-06-16): add `reports_to` — Zenhance is a *formal-vs-delivery* product
**The why, the personas, the analytics design language, and packaging now live in [PRODUCT.md](PRODUCT.md) — read that, not a re-derivation here.** TL;DR for this feature: add `people.managerId` (formal layer) alongside the existing delivery layer; the **delta** between them is the moat, **delivery analytics** are the headline. Concrete build steps are in **▶ Next build** at the top of this file.

- **User-defined / custom fields** — let a workspace add its own fields to people and/or units (beyond the fixed schema), and surface them in panels, filters, and import mapping. Touches `lib/db/schema.ts`, the import column-mapping, and the detail panels.
- **People roles & job function** *(discuss — Data Model + Analytics)* — capture *what a person does*: developer, QA, scrum master, etc. **Current state:** `person.title`, `person.skills[]`, `person.growthFocus`, and `assignment.roleOnTeam` are all **free text** — nothing structured. Open questions:
  - Is "role" a person's **discipline/job** (global to the person) vs their **role on a specific team** (`assignment.roleOnTeam`)? Probably both — a developer can be a tech lead on one team and an IC on another.
  - **How flexible:** free text vs a structured taxonomy (enum / workspace-defined role list) vs tags. Structure enables analytics (count developers, find teams with no QA, role-based gaps); free text is easier but un-analyzable. Likely a workspace-defined list (ties into custom fields above).
  - **Manual editing UX:** how does a user create/rename/assign roles and edit a person's data inline — in the person panel, the People CRUD page, or both? This is the "let me just fix this person" flow that has to feel effortless.
  - Payoff for Analytics: filter/group/colour the map by role, role-coverage gaps, and richer search than name-only (relates to the scrapped search/filter + cross-cutting roles notes under Analytics).
- **Sub-groups (teams-of-teams nesting)** — deeper hierarchy than the current group→team→members. *"Need to see this in the demo"* — extend `lib/db/seed.ts` / `demoSeed.ts` so the demo org actually shows multi-level nesting, then confirm the viz + zoom handle it.
- **Lifecycle status (active / on-hold)?** — the field the scrapped search filter assumed. Decide here whether units/people get a status concept (and whether it's a fixed enum or just a custom field via the story above).

---

## Feature: Functionality  🔜
> Interaction & polish that make it feel touch-native. Mostly self-contained viz/UX work.

- **Double-tap to center** — *(the original F2 that got dropped when F2 was redefined.)* Double-tap a node → smooth transition that centers + scales to fit. ⚠️ **Rebase onto canvas** — the old note pointed at `RadialOrg.tsx`'s `d3-zoom` filter, which S5 deletes. Build it against `OrgCanvasStage`'s zoom instead.
- **Animated transitions** — smooth position interpolation on drill-down and overlay switches (today they snap).
- **Scenario save / compare** — persist multiple what-if scenarios and diff them side-by-side (builds on the existing in-memory `moves` overlay). `map_nodes.boardId` is left flexible for exactly this.
- **Responsive panel + touch targets (iPad)** — detail `<aside>` → bottom sheet under `lg`; ≥44px touch targets; SummaryBar pills wrap; SVG fills viewport. *(folded in from old M6/F4.)*
- **Empty / error states** — audit `/people` & `/teams` empty states; verify `error.tsx` / `not-found.tsx`. *(old F5; quick.)*
- ✅ **"Mini Metro" theme** — **settled by v2 (2026-08-25):** the light/flat/calm paper register becomes the whole app's look, not an optional palette. Built in story **S3 `v2-paper-shell`** — see [V2-BUILD-PLAN.md](V2-BUILD-PLAN.md).

---

## Backlog  🅿️ *(post-v1, not committed)*
- **Edge-type layer toggles** — separate visibility for "reporting" vs "project assignment" edges. **Promoted into v2 story S6 `v2-zones-layers`**; already working in the canvas lab.
- **Workspace invites & roles** — Clerk Organizations already supports it; v2.
- **Live data connectors** — Jira / ADO / HRIS import; v2+.
- ✅ **Marketing site** — **shipped & deployed to prod 2026-06-16** (commit `a69edeb`). Multi-page site under `app/(marketing)/` (Home / Features / Pricing / About) with shared header/footer in `components/marketing/`. Live at https://zenhance.vercel.app. *Follow-up: pricing numbers are introductory placeholders ($29/mo Team) — replace with real pricing when decided.*

---

## Working agreements
- **Branch per story** (`<feature>-<slug>`, e.g. `func-double-tap`), squash-merge to `main`. Patch-bump `package.json` per merge; minor bump (→ 0.2.0) when a Feature completes.
- **Deploy:** Vercel preview per branch push; promote to prod after a Feature lands or for a demo.
- **Verification:** Nate eyeballs UI himself — no preview-screenshot loops. `npx tsc --noEmit` + tests are the cheap gate.
- **Analytics work is gated on a design discussion** — don't code it cold.
