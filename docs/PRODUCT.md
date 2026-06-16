# Zenhance — product & design guide

> **Why** the product is shaped this way. Read this *once* to get oriented, then stop.
> `ROADMAP.md` = what to build next · `CODEMAP.md` = where code lives · this = the durable *why*.
> Terse on purpose. Add decisions as one-liners; don't write essays.

## Two personas, one seam
- **Configurer** (delivery owner): maintains the roster, kills "the cursed Excel," wants a shared source of truth. Gets **operational relief**. → **FREE**.
- **Consumer** (leadership / COO): reads structural risk, holds budget. → **PAID**.
- The tier line sits exactly on this seam: **operational structure = free, executive insight = paid.** The free user (configurer) hooks the product; finishing onboarding *recruits* the paying consumer (the growth loop).

## Core thesis: formal vs delivery
- Two structures over the **same people**:
  - **Formal** = `reports_to` (a tree). *Not in the schema yet* — see ROADMAP next-build.
  - **Delivery** = membership (a graph). *Exists today*: `orgUnits` tree + `assignments` edge.
- The **delta between them** (manager blind spot, phantom departments, authority/work mismatch) is our **differentiated capability** — computable only by subtracting the layers, and nobody else has the delivery layer. It's a **moat, not the headline.**
- **Value depends on the entry door:**
  - **Delivery-first** (the common case): they already know the org chart is fiction. Payoff = **delivery analytics themselves** (over-alloc, coupling, bus factor, sourcing, distribution, cost). **Depth investment goes here.**
  - **Formal-first** (leadership who live in the org chart): the morph + the delta is the gut-punch. The delta earns its keep here.

## Analytics design language — "analytics as places"
The map is the hero; analytics **annotate** it, never a separate dashboard.
- **Ambient** (nothing selected): every finding marked on the map at once, **equal weight — presence, not priority.** Count dots per unit (count = a *fact*). Colour = **category, not severity** (no hue means "bad"). The map is always quietly watching your back, never just decoration.
- **Focus** (one selected): map flies there + spotlights it; the card expands **Signal (stat, at rest) → Narrative (story, on focus).**
- **No cross-type "which is worse" judgment — ever.** The only honest signal levers: **count**, and **within-type magnitude** (165% > 110% is arithmetic). Cross-type priority is the **user's click**, not our algorithm.
- **No AI needed** for launch insights — all deterministic graph queries (`GROUP BY` over the edge).
- Reference implementation of this feel: `app/lab/analytics` (see `LAB.md`).

## Findings menu (the product = the finite set of detectable "messes")
| Finding | Data needed | Status |
|---|---|---|
| Over-allocation | `assignments.allocationPct` | **exists** (`overAlloc` memo) |
| Shared-person coupling (team↔team) | `assignments` (`GROUP BY`, derived) | **cheap, today** |
| Span of control / layering / depth | `reports_to` | needs formal layer |
| Manager blind spot / phantom dept (the delta) | both layers | needs formal layer |
| Bus factor (role held by ~1 across many) | structured `role` | needs field |
| Outsourcing exposure (per person) | `employment_type` | team-level today (`orgUnits.isExternal`/`vendorName`); needs person field for full |
| Distribution drag | `location/timezone` | needs field |

## Packaging
- **Build the paid superset, gate *down* to free.** When stripping, remove **whole capabilities cleanly** — no greyed-out amputation scars.
- **Free:** org map + roster + structure. Plus **one** COO-grade teaser from free fields (outsourcing exposure) to sell the paid layer.
- **Paid:** the executive insight layer.
- **Enterprise:** integration build projects (services revenue — funds the work *and* hardens the data model against real orgs).
- Free people-cap is a backstop for giant orgs; the real conversion fence is **features**, not size.

## Data model spine
- **Rigid spine (don't let users redesign):** `person` · `team` (`orgUnits` self-ref tree) · `membership` (`assignments`, weighted). **Add:** `reports_to` (`people.managerId`, self-ref, nullable, workspace-scoped).
- **Open attribute bag** for arbitrary uploaded columns; a small set of **recognized** attributes power analytics (`employment_type`, `role`, `timezone`, `allocationPct`).
- **Derived, never stored:** team↔team coupling, and every "delta" insight.
- **Ingest greedily, display selectively:** take every column; only visualize what the current lens needs.

## Decisions log (one line each, newest first)
- **2026-06-16** — Add `reports_to`; Zenhance is a formal-vs-delivery product. Analytics design language locked ("analytics as places", ambient = presence-not-priority, Signal→Narrative). Build superset / gate down. *(captured from the biz-analysis chat that produced this doc)*
