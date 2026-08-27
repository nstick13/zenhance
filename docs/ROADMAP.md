# Zenhance roadmap

Organized as **Features → Stories**. This is the canonical roadmap (replaces the old M0–M8 milestone plan). For *how* the code is laid out, see [CODEMAP.md](CODEMAP.md).

> **Vision (Greg, co-founder):** "SimCity for a COO on an iPad." A delivery org you can zoom, pan, search, and rearrange like a living map — surfacing what the structure hides (over-allocation, gaps, cost/ROI).

## Status — as of 2026-08-27
- **Version 0.1.35** on `main`. **No migration needed for 0.1.35.** **Migration `0005` is applied in Neon (verified 2026-08-27)** — prod schema matches the code: `workspaces.lens` + `workspaces.vocabulary`, `disciplines.color` + `sort_order`, and all four S2 columns on `people`. Stack: Vercel + Neon Postgres + Clerk auth. Migrations `0003` (people attributes) and `0004` (`workspaces.lens`) must be applied by hand in Neon's SQL editor **before** the deploy — Drizzle's `select()` names every column, so an unapplied migration 500s every query touching that table, and `0004`'s table is `workspaces`, which means the whole app.
- ✅ **Migration `0005_stormy_red_ghost.sql` (`workspaces.vocabulary`) is applied** — locally and in Neon. Like `0001`/`0003`/`0004` it is **not** in Drizzle's `__drizzle_migrations` ledger, so a future `db:migrate` may try to replay it.
- ⚠️ **Process lesson from `0005`, worth not repeating:** the code was pushed to `main` before the migration was applied. If `main` auto-deploys, that window is a hard prod outage — `requireWorkspace` selects every `workspaces` column, so *every* page 500s, not just the new tab. **Apply the migration first, then push.** Also: paste **bare SQL** into Neon's SQL editor — a `psql ... -c '...'` shell wrapper gives `syntax error at or near "psql"` (SQLSTATE 42601).
- **v1 core shipped:** multi-tenant schema + auth scoping; People/Teams CRUD; CSV/Excel import; the radial D3+SVG viz with drill-down + panels; drag-to-reassign + scenario mode; analytics overlays; palette switcher; zoom & pan.
- **V2 canvas is the live map** (`components/viz/OrgCanvas.tsx`, `/org?view=canvas`) — see [V2.md](V2.md) for the full build log. Shipped through V2.2: persisted positions, analytics overlays, scenario mode, drag-to-reassign, team reparenting, inline create/edit/delete for people and teams, and (v0.1.16–22) the cross-cutting seat model.
- **Cross-cutting people are done** (v0.1.16–22): everyone whose home is elsewhere holds a **ghost seat** in each team they serve — amber for multiple teams, indigo + halo for multiple value streams. No floating nodes, no connection lines. The old two-tier "satellite + lines" design and the shared-people rail were both built, looked at, and rejected.
- **Sizing carries meaning** (v0.1.19): team circles scale with seat count, member rings scale to give each seat ~104px of arc, value streams are rectangles sized to their contents.
- **Terminology (v0.1.21):** the top rung is a **value stream**, not a "release train." App-level only — no migration was needed, since `org_units.kind` is just `group | team`.
- **`/org` is the canvas** (v0.1.27). The radial is at `/org?view=radial` — still reachable by URL, but **unlinked as of v0.1.32**; kept only until its FindingsRail and formal layer port.
- **Vocabulary is now per-workspace** (S5 tab 1): the shipped defaults are still **value stream** / **team**, but `/settings` edits both rungs and `workspaces.vocabulary` (jsonb) carries them. Presets: generic, SAFe, vertical product group. Display strings only — `org_units.kind` is still `group | team`.
- **Paper palette across the whole app** (v0.1.27–28) via Tailwind tokens in `globals.css`. Marketing keeps its own dark treatment by choice.
- **Multi-team membership is editable from the map** (v0.1.26) — panel Teams section, or ⌥-drag a person onto a team to add rather than move.
- **Marketing site** live at https://zenhance.vercel.app.
- ✅ **Fixed (S5 tab 2) — disciplines are reachable outside the demo seed.** `/settings` now creates, renames, recolours, reorders, merges and deletes-with-reassign; `disciplines.color` and `disciplines.sortOrder` are live schema again, and colour-by-discipline reads the stored colour rather than always falling to the ramp. Data work sits in `lib/data/disciplineOps.ts`, wrapped by the actions in `lib/data/actions.ts`. Import mapping for a discipline column is still outstanding (S2).

---

## 📞 Customer signal — Heather call (2026-08-27)

Heather McFarland (former boss; VP-level delivery/org-design practitioner, ~1,000-person tech org inside a 7–10k company, **90 pods**). The first outside-practitioner read on the built product. **Source: full transcript, not the AI summary** — the summary flattened her emphasis and misattributed one position (see below). Nothing here reorders **▶ Next build**; it is input to that call, not a replacement for it.

### Her framing, in her words
- **Portfolio + finance is "the big unlock"** — *"that whole Excel minded data folks and Org design and portfolio management I think is the big unlock for this."* Not a side feature; the thing she got animated about.
- **Data will never be good** — *"I don't think we're ever going to get good data. I mean, anywhere."* What she wants is triage *before a conversation*: pull Workday → Jira → division-head spreadsheets, reconcile, flag what's wrong, reach *"close enough for what we want to talk about."*
- **Terminology must be editable** — they say "vertical product group" but still mean value stream. *"That would actually be really useful as an updatable title"* — plus *"give them examples with some metadata. Like, hey, here's how we would use this."*
- **"ESRI for people"** — her unprompted analogy, matching Nate's own: the value needs consulting to configure, which is the packaging thesis in [PRODUCT.md](PRODUCT.md).

### ⚠️ Corrections to the AI-summary reading
| The summary said | The transcript shows |
|---|---|
| "System of record" is Heather's priority #2 | **Nate** said it, not Heather. She explicitly expects data to stay bad. Her ask is *cleanup-for-a-conversation*, not authority over data. **The "is Zenhance a data platform?" tension is much weaker than it looked** — no positioning decision is actually blocked. |
| Portfolio/financial = priority #4 | She calls it **the unlock**. Ranked first by emphasis. |
| Git-style scenario branching = medium priority | **Nate raised it; Heather did not engage.** No external validation — keep it, but don't credit it to customer demand. |

### 🔴 The modeling gap this exposes — a missing *work* axis
Her core computation: *"team spent a quarter of the time on X in quarter Y equals $48,000,"* rolling up to OPEX/Capex; and structurally, *"moving teams to work instead of work to teams."*

Zenhance has **no concept of work**. `assignments` maps *person → org_unit* and carries no time dimension at all — every allocation is implicitly "now, forever." What this needs is a second axis: **team → body of work → quarter → cost**, where a body of work is a product / project / feature / program / cost centre.

That is a new entity plus a new join table, **not** a date column on `assignments` — and it is the prerequisite for the thing she considers the unlock. It also does not render as the canvas: *"they're not going to want blobs"* → this surface needs real charts, queryable alongside the map. **Size this before committing; do not start it on the strength of one call.**

### 🟢 Near-term win this unlocks — the pod template
Her CTO is actively asking how their **90 pods** rate against agile maturity. Her framing is concrete: an ideal pod has a defined set of roles; compare each pod's actual composition against it; surface gaps; drive hiring. Same shape as her ART-creation scenario (*"you don't have the roles that I would consider that you need"*).

This is **role-coverage analytics on `disciplineId`** — which S4 already half-does ("Tideway has no QA"). Generalising it into a workspace-defined **pod template** with a compare-to-ideal view is a modest lift on data already live in prod, and it answers a question a CTO is asking this quarter. Best effort-to-value ratio in the call. Still subject to the 🧭 design-first rule for Analytics — **a first pass is now drawn** (`design/PodTemplate.dc.html`, on the canvas linked below): role ranges rather than fixed counts, a sortable gap table rather than the map (*"they're not going to want blobs"*), and it only became answerable on customer data now that S2 import fills `disciplineId`.

### Scale — a real target
**~90 teams / ~1,000 people** is the fixture to test against (demo org is 45). **Measured 2026-08-27** — `npm run db:scale` generates the synthetic org, `lib/canvas/__tests__/scale.bench.mts` times it:

| | People | Teams | Nodes | Ghost seats | `buildCanvasMap` | Findings |
|---|---|---|---|---|---|---|
| Demo | 45 | 7 | 53 | 22 | 0.07 ms | 15 |
| **Heather's scale** | **1,000** | **90** | **1,091** | **539** | **1.72 ms** | **233** |
| One beyond | 2,000 | 180 | 2,181 | 1,068 | 5.21 ms | 410 |

**The worry was misplaced and the result reprioritises something else.** The ghost-seat model does **not** break: `buildCanvasMap` is a linear pure transform, under 2 ms at target and ~5 ms at double. Konva render cost at ~1,600 seat-like elements is still un-eyeballed and is the remaining unknown.

What *does* break is the **findings rail: 233 entries at target scale**, superlinear because `computeCouplingFindings` (`lib/analytics/findings.ts` ~61–99) is O(units²) over ~5,000 unit pairs. Fast in milliseconds, unusable as a list. **This is the strongest argument yet for the configurable/triaged model** — see the design canvas below.

### Terminology — confirmed, and it contradicts a settled position
Status above says *"Vocabulary is settled: top rung = value stream (never 'release train')."* That was settled internally; a customer-facing product cannot hold it. Cheap to fix — app-level strings only, since `org_units.kind` is just `group | team` — and it now wants **starter templates** alongside the editable label, per her "give them examples" note.

### Pilot
Heather offered feedback and may be able to use it internally — *"probably not with real data."* A synthetic or anonymised path matters if the goal is getting her hands on it.

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

### S2 — Recognized person attributes  *(schema + editing v0.1.29; **import mapping shipped v0.1.34**)* ✅
**Done:** `disciplines` table per workspace + `people.disciplineId`; `people.employment` (fixed enum `fte|contractor|vendor|unknown`); `people.location`; `people.timezone` (IANA). Migration `0003_silent_power_pack.sql`, applied by hand in Neon's SQL editor (and locally with `psql -f`) — **not** recorded in Drizzle's `__drizzle_migrations` ledger, same as `0001`, so a future `db:migrate` may try to replay it. Editing lives in the canvas person panel/form and `/people`. `ensureDiscipline` is find-or-create.

**Three fields, deliberately distinct — do not conflate:**
| Field | Answers | Scope | Structure |
|---|---|---|---|
| `people.disciplineId` | what they *are* | person, global | workspace-defined list |
| `assignments.roleOnTeam` | what they do *here* | per assignment | free text |
| `people.title` | their HR label | person, global | free text |

**Done (v0.1.34) — import column-mapping.** All four fields map in the wizard, and the S2 story is closed.
- ✅ **Nothing blocks an import.** Heather's *"we're never going to get good data"* is the governing assumption: an unrecognised value degrades to empty and comes back as a counted, non-blocking **warning** on the result. `"Contractor (Infosys)"` → `contractor`; `"IST"` → `Asia/Kolkata`; `"Band 7"` → `unknown` rather than a guess. A timezone that can't be resolved is left **null**, never stored wrong — a wrong zone would make distribution drag report a spread that isn't real.
- ✅ **Title → discipline is opt-in, with a preview.** The wizard offers it only when a title column is mapped and a discipline column is not, and shows exactly what the pass would create ("would fill 38 of 45 · Engineering 18 · QA 6 · 2 new" + sample misses) before you commit. Inventing a taxonomy silently is the one thing this must not do; an unmatched title leaves the field empty.
- ✅ **Suggestions reuse the workspace's own taxonomy first.** "Senior Software Engineer" resolves to an existing *Software Engineering* rather than creating a near-duplicate *Engineering* beside it (a shallow stemmer bridges Engineer↔Engineering). Rules are ordered so "QA Engineer" isn't Engineering and "Product Manager" isn't Management.
- ✅ **Find-or-create runs inside the import transaction** (not the old `ensureDiscipline` action, now deleted): a half-committed taxonomy would be worse than a failed import.
- ✅ All meaning lives in one pure module, `lib/data/importMapping.ts` (19 Vitest cases). The commit engine moved to `lib/data/importCommit.ts` so `importS2.integration.mts` drives the **real** code — the older `import.integration.mts` re-implements the logic and therefore proves nothing about it.

*Two bugs this surfaced and fixed:* ICU matches IANA zone names case-insensitively, so `europe/berlin` was being stored verbatim and would never group with `Europe/Berlin`; and `Etc/GMT` inverts its sign, which would have mislabelled all of Europe.

### S3 — The lens config  *(colour-by + label-by shipped v0.1.31; toggles outstanding)*
Per-workspace, persisted to `workspaces.lens` (jsonb). Migration `0004_mean_spirit.sql` — **hand-apply in Neon before the deploy**, same as `0001`/`0003`: `requireWorkspace` does `select({ workspace: workspaces })`, so until the column exists *every* page 500s.

**Done (v0.1.31):**
- ✅ **Colour by** utilisation (default, unchanged) / discipline / employment / value stream. Disciplines use `disciplines.color` when set, else a ramp; a *missing* value is grey (`NO_VALUE_COLOR`), never a ramp slot, so a gap reads as a gap.
- ✅ **Label by** name / name + title / initials. Initials render *inside* the seat — at that setting the point is the org's shape, not its roster.
- ✅ **Legend follows the lens**, counting only values present on the map, most-populous first, missing-value bucket pinned last. The two dashed cross-cutting entries are *shape*, not colour, so they survive every lens.
- ✅ **Ghost seats obey the lens too** — under a non-default colour they answer the lens's question; "shared" is carried by the dash, the smaller radius and the halo. Under utilisation they keep the amber/indigo tiers exactly as before.
- ✅ **Facts outrank the lens:** the over-110% pip stays red under every setting, so colour-by-discipline can't hide who is drowning.
- ✅ All meaning lives in one pure module, `lib/canvas/lens.ts` (18 Vitest cases). Applied optimistically, persisted in the background — a display preference never makes the map wait on a round-trip.

**Outstanding — the toggles.** *Unblocked as of v0.1.35: the workspace-default vs my-view split they were waiting on now exists, so a new toggle can be added without widening the blast radius. Per the S5 decision they belong in the Map defaults tab, not a new `LensChoice` row.*

 cross-cutting render mode; the shared-people rail (built v0.1.21, removed v0.1.22 — it should return as an *option*, not a fixture; restore from `0783c92`); stat lines; stream headers. Each is a `Lens` field + a row in `LensChoice`; `normalizeLens` already degrades unknown blobs per-field, so adding one can't break an existing workspace.

- *Why this before finishing S2:* the demo org already carries the data, colour-by-discipline is the most direct proof of the configurability thesis, and import mapping is the bigger chunk that benefits from knowing which fields earn a place on the map. **Flip the order if a real pilot is closer than a pitch** — display for data nobody can import is backwards for an actual customer.

### Canvas editing — value streams  *(shipped v0.1.33)*
- ✅ **Drag a value stream** — the hull is derived from its contents, so dragging it translates every team in the stream and every seat in those teams; the box follows because it is recomputed from them. Konva's own `draggable` can't drive a computed position, so the gesture is tracked from pointer deltas in world space. Only the **header strip** grabs — the hull covers most of the viewport and swallowing drags there would cost pan-anywhere. Persisted in one `saveMapNodePositions` write rather than one per node.
- ✅ **`+ Value stream`** in the toolbar — creates a `kind: "group"` unit beside the existing streams (never nested under one). `buildCanvasMap` no longer drops empty streams: one that vanished on creation would also be missing from the team form's stream picker, leaving no way to fill it. An empty stream parks to the right of the map with an "Empty — add a team to fill it" header and no drag handle.

### S4 — The findings S2 unlocks
Each was blocked on nothing but a missing field. Paid-tier material. The demo org now has a planted example of each:
- **Bus factor** (`disciplineId`) — Devraj Patel is the only Security discipline, across 4 teams.
- **Per-person outsourcing exposure** (`employment`) — contractors sitting *inside* Earthlight, Dawnbreak and Lighthouse, not just in the Infosys vendor bubble.
- **Distribution drag** (`timezone`) — Earthlight spans New York, São Paulo, Stockholm, Lagos and Dubai.
- **Role coverage** (`disciplineId`) — Tideway has no QA at all.

### S5 — Workspace settings (the config surface)  *(tabs 1–2 shipped)*
**Shipped:** `/settings` (`app/(app)/settings/page.tsx` + `components/settings/SettingsManager.tsx`) with **Vocabulary** and **Disciplines**. Tabs 3–5 are still unbuilt and still design-gated — see the guardrail below.
Nate's instinct: *"an admin console to toggle some ideas on and off."* The finding that justifies it is not speculative — **it is a live bug** (see Status). Config is currently accreting ad hoc: the lens is a jsonb blob edited from the canvas topbar, disciplines are a table with no UI, terminology is hardcoded, findings policy has nowhere to live.

**Call it Settings, not Admin.** `membershipRole` (`owner|admin|editor|viewer`) exists in `lib/db/schema.ts` and **nothing reads it anywhere in the app** — there is no admin concept to gate on. Naming it "Admin" implies a permission model that would then have to be built. Store config so a role gate can be added later; do not build roles now.

**Three classes of config — they want different storage. This distinction matters more than the UI:**
| Class | Examples | Storage | Why |
|---|---|---|---|
| **View preference** | lens colour/label, S3's outstanding toggles | `workspaces.lens` jsonb | Never joined or queried; `normalizeLens` degrades per-field |
| **Taxonomy** | disciplines; vocabulary labels | table (disciplines) / jsonb (labels) | Disciplines are joined and counted; labels are display-only |
| **Policy** | pod template; findings detectors, thresholds, exceptions | tables | Compared against data, needs per-item exceptions |

The **Policy** class does not exist yet. It is what the console really unlocks (pod template, and the detector/policy/exceptions model in the agent memory).

**Tabs, in build order. Guardrail: a tab may only exist once something already reads it** — a settings surface is a classic procrastination sink.
1. **Vocabulary** — editable label for the two rungs, with presets (SAFe / "vertical product group" / generic) and Heather's *"give them examples with some metadata"*. Pure display strings; `org_units.kind` stays `group | team`, no migration.
2. **Disciplines** — the missing CRUD: rename, colour, sort order, delete-with-reassign, merge. **Revives dead schema** (see Status bug).
3. **Map defaults** — lens defaults + S3's outstanding toggles, instead of adding a `LensChoice` row to the canvas topbar for each.
4. **Standards** — the pod template (ideal role composition). Feeds compare-to-ideal.
5. **Findings** — detectors on/off, thresholds, exceptions. 🧭 design-first; gated on the analytics conversation below.

**🔶 Open design question — do not let an agent decide this unasked.** Today `saveLens` fires from the canvas topbar (`OrgCanvas.tsx` ~line 270) and writes **workspace-wide, immediately**. So flipping colour-by-discipline mid-demo silently changes it for every user in the workspace, permanently. Tolerable at two settings, bad at ten. Adding toggles requires splitting **workspace default** (inherited) from **my current view** (ephemeral, per-user). That split should land *with* the toggles, not after — but the shape of it is Nate's call.

**How S5 changes the other stories — it mostly absorbs work rather than adding it:**
- **S3's outstanding toggles** are currently specced as "a `Lens` field + a row in `LensChoice`" — more canvas chrome each time. They move to the Map defaults tab; the canvas keeps only what you would flip mid-conversation. S3 stops growing the topbar.
- **Terminology** stops being a standalone story and becomes tab 1 — the cheapest slice, and it proves the container at low risk.
- **Pod template** needed bespoke UI; it becomes tab 4. This argues for a *thin* console before it, not a complete one.
- **Findings config** finally has a home for the detector/policy/exceptions model.
- **Import (S2)** is unaffected. Saved column-mapping presets could live here much later.

**Acceptance for the first slice (tabs 1–2 only) — met:** a workspace created from scratch (no demo seed) can create, rename, recolour, reorder and delete a discipline; colour-by-discipline then uses `disciplines.color` rather than always falling to the ramp; and the two rung labels can be renamed and are reflected everywhere the UI says "value stream" / "team".

### The analytics design conversation  ✅ *settled 2026-08-27 — build against these*
**All four questions are answered.** Detail and the reasoning live on the design canvas linked below; the decisions themselves are here so nobody re-derives them.

**① "On 2+ teams" is a FACT. Whether it becomes a finding is a per-discipline rule the *organisation* sets.**
There is no universally correct number of teams, and — Nate's sharpening on review — **no discipline whose answer we get to decide for them.** A Security Engineer across six teams is the job working in one org and a bus-factor/burnout risk in the next; a QA tester on two teams is a problem in most. So:
- Policy is a table keyed by `disciplineId`: *flag at N teams*, or *no limit*, or **unset**.
- **Ship seeded values, not advice.** Where the trade-off is genuinely organisational (Security is the worked example), ship the row **unset** with the trade-off written beside it rather than a confident default. Shipping a confident default is the same mistake as hard-coding the platform exemption was.
- **This absorbs the exclusion layer.** "Platform is exempt" is just a discipline with no limit — one mechanism instead of two, and it reuses the same taxonomy the pod template needs.
- The detector splits in two, both count-based: **Spread** (per-discipline team count) and **Over-commitment** (declared > 100%).
- Free win regardless of policy: **3 of the 6 current over-allocation findings are noise under any threshold** (Angela 2t/100%, Helena 2t/100%, Grace 2t/80%).

**② The top of the canvas is orientation and control, never content.** Search (the missing primitive at 90 teams), the lens chip, a findings *count* that opens a rail, scenario state (an invisible mode is a bug). Findings stay on the map in the node/edge/region shape vocabulary. A top findings rail is rejected on the evidence of the shared-people rail.

**③ Findings config = detector on/off → per-discipline policy → exceptions.** Exceptions are filed per instance with a reason, attributed and dated; the "9 of 12 reviewed" counter is itself the signal. **This is the first tab needing real tables rather than a jsonb blob** — the actual justification for the settings surface.

**④ 🔶 resolved and ✅ SHIPPED v0.1.35 — the canvas edits *my view*; only Settings edits the workspace default.** Affordance: a "Just for me" chip with *Reset* / *Make default*, reusing the scenario chip's dot grammar. Workspace default stays in `workspaces.lens`; my view is per-user and needs no migration. ~~**This is a live bug today**~~ — **fixed in v0.1.35.** The topbar now writes only my view (`lib/canvas/myView.ts`, browser storage keyed by workspace, 13 Vitest cases); `saveLens` fires only from **Make default**. Amber dot = "yours, and you can step out of it" (the scenario chip's grammar); the workspace-wide non-default dot is muted, because shared state isn't one person's to undo. Storage that throws or holds garbage degrades to the workspace default rather than crashing the map. **No migration.**

**Still open, deliberately:** whether a "declared %" belongs on a finding at all. Keeping it contradicts the settled *no % in findings* rule; the case is argued on the canvas rather than assumed.

<details><summary>The original three questions, kept for context</summary>

**Do not port the findings rail cold.** Three questions:
1. **Is "on 2+ teams" a finding, a fact, or a filter?** `computeOverAllocFindings` currently skips only when `teamCount <= 1 && totalPct <= 100`, so anyone on 2+ teams fires as "over-allocation" regardless of load — Grace Okafor at **80%** is labelled over-allocated. That is a definition question, not a bug fix; see the detector/policy/exceptions model in the agent memory.
2. **What belongs at the top of the canvas?** Findings are one candidate; so are the value stream cabinet, scenario state, and search. The shared-people rail was built and rejected there once already.
3. **What is the *config*** for findings — decide that before building the thing it configures.
Verified 2026-08-26: `computeAllFindings` fires **9** findings on the demo org (6 over-allocation, 3 coupling) with real narratives. The engine is sound; only the presentation and the definitions were open.

</details>

#### 🎨 Design canvas — proposals to react to (2026-08-27)
**[Zenhance Analytics Decisions](https://claude.ai/code/artifact/6fe1d5d9-59f6-41f4-82e9-05407891f78f)** — five artboards, one recommendation per open question, sources in `design/*.dc.html`. **Nothing here is built or decided; it exists to be argued with.**

**Q1 — finding, fact, or filter? → It's a *fact*; the finding is what the fact costs.** Measured on the demo org, the current detector fires on 6 people:

| Teams | Declared | Person | Under the proposed split |
|---|---|---|---|
| 4 | 120% | Devraj Patel | spread + over-committed |
| 3 | 120% | Marcus Webb | spread + over-committed |
| 3 | 105% | Yuki Tanaka | spread + over-committed |
| 2 | 100% | Angela Smith | fact only |
| 2 | 100% | Helena Brandt | fact only |
| 2 | 80% | Grace Okafor | fact only |

**Half the over-allocation findings are noise** — Grace is labelled over-allocated at 80% under nominal load. Proposal: split into two count-based detectors, **Spread** (≥ N teams, default 3) and **Over-commitment** (declared > 100%), and let the ghost seat carry the plain fact. Same lever that makes 233 tractable at scale.

**Q2 — what belongs at the top? → Orientation and control, never content.** Search (the genuinely missing primitive at 90 teams), the lens chip, a findings *count* that opens a rail, and scenario state (a mode must be visible). Findings themselves stay on the map in the settled node/edge/region shape vocabulary. A top findings rail is rejected on the evidence of the shared-people rail.

**Q3 — the config → the three layers become three visible things.** Detectors you switch on; a policy with a threshold and standing attribute exclusions (the platform exemption was never a special case — it's a seeded default exception); and per-instance exceptions with a reason, attributed and dated. The "9 of 12 reviewed" counter is itself the trust signal. **This is the first tab that needs real tables rather than a blob** — which is the actual argument for the settings surface existing.

**🔶 Q4 — workspace default vs my view → the canvas edits *my view*; only Settings edits the default.** Recommended affordance: a "Just for me" chip with *Reset* / *Make default*. Note this is a **live bug today**, not a future concern — `saveLens` already writes workspace-wide from the topbar, so a mid-demo lens flip changes it permanently for everyone. Worth fixing on its own, ahead of any new toggle.

**Two calls left deliberately to Nate:** the Spread threshold (3?), and whether a "declared %" belongs on a finding at all — keeping it contradicts the settled *no % in findings* rule, so the canvas argues the case rather than assuming it.

### Later — `reports_to` + the formal layer
Still wanted, still the documented moat, and it now has a home as the *Reporting* layer toggle on the canvas. Sequenced **after** the above deliberately: [PRODUCT.md](PRODUCT.md) says delivery-first is the common entry door and that depth investment belongs in delivery analytics. Build steps: `people.managerId` self-ref + migration; import mapping for `manager`; the three-door entry picker; formal render mode; demo data whose reporting chain **diverges** from the teams (the mess is the pitch).

### Also wanted, unscheduled
- **Retire the radial** — `/org` is the canvas as of v0.1.27; the radial lives at `/org?view=radial`, is **no longer linked from anywhere** (v0.1.32), and is kept **only** because it still owns the FindingsRail and the formal (`managerId`) layer. Archive `RadialOrg.tsx` once both port.
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
