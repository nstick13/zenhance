# Zenhance roadmap

Organized as **Features → Stories**. This is the canonical roadmap (replaces the old M0–M8 milestone plan). For *how* the code is laid out, see [CODEMAP.md](CODEMAP.md).

> **Vision (Greg, co-founder):** "SimCity for a COO on an iPad." A delivery org you can zoom, pan, search, and rearrange like a living map — surfacing what the structure hides (over-allocation, gaps, cost/ROI).

## Status — as of 2026-08-26
- **Version 0.1.23**, deployed to **production** on Vercel (Neon Postgres + Clerk auth).
- **v1 core shipped:** multi-tenant schema + auth scoping; People/Teams CRUD; CSV/Excel import; the radial D3+SVG viz with drill-down + panels; drag-to-reassign + scenario mode; analytics overlays; palette switcher; zoom & pan.
- **V2 canvas is the live map** (`components/viz/OrgCanvas.tsx`, `/org?view=canvas`) — see [V2.md](V2.md) for the full build log. Shipped through V2.2: persisted positions, analytics overlays, scenario mode, drag-to-reassign, team reparenting, inline create/edit/delete for people and teams, and (v0.1.16–22) the cross-cutting seat model.
- **Cross-cutting people are done** (v0.1.16–22): everyone whose home is elsewhere holds a **ghost seat** in each team they serve — amber for multiple teams, indigo + halo for multiple value streams. No floating nodes, no connection lines. The old two-tier "satellite + lines" design and the shared-people rail were both built, looked at, and rejected.
- **Sizing carries meaning** (v0.1.19): team circles scale with seat count, member rings scale to give each seat ~104px of arc, value streams are rectangles sized to their contents.
- **Terminology (v0.1.21):** the top rung is a **value stream**, not a "release train." App-level only — no migration was needed, since `org_units.kind` is just `group | team`.
- **Marketing site** live at https://zenhance.vercel.app.

---

## ▶ Next build (start here)

> **The through-line:** Nate's three instincts (2026-08-26) — *"make it configurable," "the load screen is uninspiring," "show who owns a value stream"* — converge on one sequence. You cannot offer "colour by discipline" or "show FTE vs contractor inside a team" until those are real fields; and the moment they are, three findings from [PRODUCT.md](PRODUCT.md)'s menu unlock for free. **The field layer is the unlock; the display config is what makes it feel personal.**

### S1 — Look & feel + stream ownership *(shipped v0.1.23)*
Pure viz, no schema. Fixes the flat first impression and lands the first slice of stream ownership.
- ✅ **Value stream identity colour** — each stream gets a stable hue (`STREAM_HUES`), used as a wash in its rectangle, its header type, and the stroke of every team inside it. Deliberately avoids violet (external vendors), ghost amber, and utilisation red, so identity never reads as status.
- ✅ **Stream header block** — accent bar + name + `Led by <lead>` · teams · people · cost. **"No owner" renders in red** — the first ownership finding, free.
- ✅ **Entrance choreography** — an 820ms intro clock assembles the map (hulls → teams → seats settling outward into their rings) instead of showing it pre-built. Honours `prefers-reduced-motion`.
- ✅ **Open on a view, not a fit** — lands on the value stream with the most open roles rather than framing the whole world at the least informative zoom.
- ✅ **Depth** — soft shadows under team circles and stream cards.

### S2 — Recognized person attributes  ⬅ **next**
Small migration, big unlock. See the *People roles & job function* story under Data Model for the open questions (discipline vs role-on-team; taxonomy vs free text).
- `role` / discipline — **workspace-defined list**, not free text (free text is un-analyzable).
- `employmentType` — FTE / contractor / vendor. Today this is team-level only (`orgUnits.isExternal`), which is why a contractor sitting inside a normal team is invisible.
- `location` / `timezone`.
- Extend the **import column-mapping** and the **person panel's inline edit** for all three. "Ingest greedily, display selectively."

### S3 — The lens config
Per-workspace, persisted. This is the "other people would want other things" story, and it needs S2 to have anything to key off.
- **Colour by:** utilisation (today) / discipline / employment type / value stream.
- **Label by:** name / name + title / initials.
- **Toggles:** cross-cutting render mode (the configurable-rendering note under Analytics folds in here), the shared-people rail (built and removed in v0.1.21–22 — bring it back as an option, not a fixture), stat lines, stream headers.

### S4 — The findings S2 unlocks
Each was already blocked on nothing but a missing field. Paid-tier material.
- **Bus factor** (needs `role`) · **per-person outsourcing exposure** (needs `employmentType`) · **distribution drag** (needs `timezone`).

### Later — `reports_to` + the formal layer
Still wanted, still the documented moat, and it now has a home as the *Reporting* layer toggle on the canvas. Sequenced **after** the above deliberately: [PRODUCT.md](PRODUCT.md) says delivery-first is the common entry door and that depth investment belongs in delivery analytics. Build steps: `people.managerId` self-ref + migration; import mapping for `manager`; the three-door entry picker; formal render mode; demo data whose reporting chain **diverges** from the teams (the mess is the pitch).

### Also wanted, unscheduled
- **Full product cabinet** — S1 ships a single owner per stream from the existing `orgUnits.leadPersonId`. A real cabinet (product owner + eng lead + delivery lead) needs role-tagged people attached to a *group* unit; `assignments` are currently restricted to `kind === "team"`, so this is new modeling. Do it after S2's role field exists.
- **Ownership analytics** — streams with no owner (partly shipped: the red "No owner"), one person owning several streams, an owner barely allocated to the stream they own.

---

## Feature: Analytics  🧭 *design-first*
> **Do not start coding these without a design pass first.** This whole feature gets a separate, non-coding discussion (the "what should the visualization reveal?" conversation). Stories below are seeds, not specs.

- **Search & filter** — *attempted as F3, scrapped 2026-06-16 pending rethink.* Search people/teams; narrow the view by attributes (e.g. utilization band). **Learnings to carry in:**
  - Dimming non-matches alone was **not legible**, especially for a touch/iPad glance. Matches need an *additive* highlight (halo/ring/spotlight), not just everyone-else-fades.
  - The originally-specced "active / on-hold" status filter **has no backing data** — see Data Model. Decide the data question before rebuilding this.
  - Open design Qs: fuzzy vs substring; how matches behave across zoom/bloom levels; whether filter narrows the *layout* (hide) or just *emphasis* (dim).
- **Burnout risk overlay** — schema already has `person.last_vacation_at`; combine with tenure for a risk heat/badge overlay (parallels the cost overlay pattern in `getOverlayProps`).
- **Cross-cutting / shared roles** *(discuss in the Analytics chat)* — model and visualize people who support **across** the structure rather than sitting inside one team: e.g. someone covering security or compliance for an entire value stream / "delivery group," or an IT function that serves many teams. Today the demo data treats people as members of specific teams; we need to represent a person whose support spans a whole group (or multiple groups) and decide how that reads in the radial map — a satellite around the group? an edge to every team they touch? a separate "function" layer? This ties directly into the multiple-allocation analytics (these people are *the* over-allocated, shared resources) and into the Data Model (sub-groups, edge types). Bring real examples (security/compliance/release-value stream support) to the discussion.
  - **Design decision (2026-08-26) — two tiers, configurable rendering.** Distinguish *cross-team* (splits within a value stream) from *cross-stream* (spans multiple value streams). Agreed direction: **cross-team → ghost seats** (duplicate presence rendered at each team ring, dashed/lighter border to signal "shared," no connection lines needed); **cross-stream → satellite + lines** (one node placed near heaviest-allocation value stream, dashed lines to others). Rendering mode must be **user-configurable per workspace** — not hardcoded — because the right metaphor depends on org structure and team size. Also needed: the immediate bug fix (auto-invalidate stale `map_nodes` positions for cross-cutting people on load, rather than requiring manual Tidy Up).
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

- **Double-tap to center** — *(the original F2 that got dropped when F2 was redefined.)* Double-tap/click a node → smooth `d3-zoom` transition that centers + scales to fit its subtree. Note: dblclick is currently **disabled** in the zoom filter (`RadialOrg.tsx` ~line 153) — re-enabling there is the starting point. Complements single-click drill-down.
- **Animated transitions** — smooth position interpolation on drill-down and overlay switches (today they snap).
- **Scenario save / compare** — persist multiple what-if scenarios and diff them side-by-side (builds on the existing in-memory `moves` overlay).
- **Responsive panel + touch targets (iPad)** — detail `<aside>` → bottom sheet under `lg`; ≥44px touch targets; SummaryBar pills wrap; SVG fills viewport. *(folded in from old M6/F4.)*
- **Empty / error states** — audit `/people` & `/teams` empty states; verify `error.tsx` / `not-found.tsx`. *(old F5; quick.)*
- **"Mini Metro" theme** — light, flat, no-glow palette (Greg's "clean, minimal, calm"). Add to `lib/theme.ts` + the `@theme static` block in `globals.css`. *(old F6.)*

---

## Known bugs

*(none open)*

- ~~**Cross-cutting connection lines appear at wrong LOD / from off-screen origin (v0.1.15).**~~ **Resolved.** Fixed in v0.1.17 (positions always re-seed from team centroids), then made moot in v0.1.20 when connection lines were removed entirely in favour of ghost seats.

---

## Backlog  🅿️ *(post-v1, not committed)*
- **Edge-type layer toggles** — separate visibility for "reporting" vs "project assignment" edges (Greg's layer concept; needs edge-type modeling → relates to Data Model).
- **Workspace invites & roles** — Clerk Organizations already supports it; v2.
- **Live data connectors** — Jira / ADO / HRIS import; v2+.
- ✅ **Marketing site** — **shipped & deployed to prod 2026-06-16** (commit `a69edeb`). Multi-page site under `app/(marketing)/` (Home / Features / Pricing / About) with shared header/footer in `components/marketing/`. Live at https://zenhance.vercel.app. *Follow-up: pricing numbers are introductory placeholders ($29/mo Team) — replace with real pricing when decided.*

---

## Working agreements
- **Branch per story** (`<feature>-<slug>`, e.g. `func-double-tap`), squash-merge to `main`. Patch-bump `package.json` per merge; minor bump (→ 0.2.0) when a Feature completes.
- **Deploy:** Vercel preview per branch push; promote to prod after a Feature lands or for a demo.
- **Verification:** Nate eyeballs UI himself — no preview-screenshot loops. `npx tsc --noEmit` + tests are the cheap gate.
- **Analytics work is gated on a design discussion** — don't code it cold.
