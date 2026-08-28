# Import corpus test — findings & recommendations

**Date:** 2026-08-27
**What ran:** all 50 synthetic orgs in `scratchpad/orgs/` (88 `.xlsx` files, ~10 to ~9,700 people)
driven through the **real** engine — `commitImport` from `lib/data/importCommit.ts`, the same
function the server action calls — after replicating ImportWizard.tsx's sheet-detection +
column auto-mapping verbatim in a harness (`scratchpad/harness.mts`).

Each org → a throwaway workspace, committed, counts + warnings + timing recorded, workspace
deleted. Multi-file orgs: each file imported in sequence into one workspace (today's UX).
Raw data: `scratchpad/import-results.json`.

---

## Headline

| Outcome | Orgs | |
|---|---|---|
| Full structure imported (people **+ teams + assignments**) | **7 / 50** | all clean, all wizard-native workbooks |
| People imported but **hierarchy + memberships silently lost** | **20 / 50** | every clean *flat* HRIS dump |
| Import **hard-failed, nothing landed** | **19 / 50** | every messy org with a date column |
| "Partial" (one file threw, net result empty) | **4 / 50** | messy multi-file |

**Two rules decide everything:**
1. **Is it a wizard-native workbook (People/Teams/Assignments sheets)?** If not, you lose all org structure.
2. **Does it have a date column with real-world dates?** If yes, the entire import is rejected.

100% of "messy" orgs (23/23) failed or imported nothing. 0% of "clean" orgs failed — but 20 of
27 came in as a flat list of people with no teams. The ROADMAP's stated principle —
*"Nothing blocks an import… an unrecognised value degrades to empty and comes back as a
warning"* — is **only implemented for the 4 S2 fields** (employment, timezone, discipline).
Dates, names, and team `kind` still hard-fail. The corpus makes that gap undeniable.

---

## Findings, most severe first

### F1 — Non-ISO dates reject the whole import  *(blocker; 19 orgs / 23 files)*
`lib/validation.ts` `optionalDate` = `/^\d{4}-\d{2}-\d{2}$/`. Import runs every person row
through `personInput.safeParse`, and one bad `startDate` pushes an `ImportError`, so the
transaction rolls back — **nothing** lands.

Real HRIS/spreadsheet dates that all fail today: `3/1/2021`, `01-Mar-2021`, `2021`,
`Q1 2021`, Excel serials (`44256`), blank-but-typed cells. `2026-06-30` in a "Total" footer row.

**Fix:** a `normalizeDate()` in `importMapping.ts`, same contract as `normalizeTimezone`:
parse the common shapes, return ISO or `null`, count the drops, surface a non-blocking warning.
Wire it into `commitImport` *before* `personInput.safeParse` (or give the import path a date
field that never hard-fails). This single change flips ~19 orgs from "nothing" to "landed with
a stated gap."

### F2 — Flat HRIS dumps lose all org structure  *(biggest product gap; 20 orgs)*
The most common real export is one sheet, one row per person, with `Department` / `Team` /
`Manager` columns. The importer has **no path to synthesize org units + memberships from
person columns** — `guessSheet` only matches sheets literally named ~"people"/"team"/
"assignment", and even when the user hand-picks the roster sheet for People, the team column
is just ignored. Result: 9,700 people, zero teams, an empty radial map. For a product whose
entire point is visualizing team structure, flat exports are currently near-useless without
the customer manually reshaping into 3 sheets.

**Fix — "flat mode":** when only People is mapped and it carries a `team` column (and
optionally `department`/`parent`), synthesize: one `orgUnit` per distinct team, a parent
`group` per distinct department, and a 100% `assignment` per person. Everyone already has a
`team` field in `ImportPersonRow` shape — it's dropped on the floor. Low-risk, additive, fixes
20/50 in one move.

### F3 — Team `kind` is a strict 2-value enum  *(blocker for wizard-native messy; 6 files)*
`orgUnitInput.kind` = `enum(["group","team"])`. Any export that says `Squad`, `Chapter`,
`Tribe`, `Pod`, `Dept`, `Division` → `ImportError` → whole import rolls back.

**Fix:** `normalizeKind()` in `importMapping.ts` (Squad/Chapter/Pod/Crew → `team`;
Tribe/Dept/Division/Group → `group`; unknown → `team` + warning). Same pattern as employment.

### F4 — Trailing junk rows fail as "Name is required"  *(blocker; several files)*
The wizard drops a row only if **every** mapped cell is `""`. A footer like
`Total | | | 250` or `Note: reconciled to HRIS 2026-06-30` has text in a *non-name* column,
so it survives the filter, hits `personInput` with a blank name, and errors out — killing the
import. Totals/notes/reconciliation lines are ubiquitous in exported sheets.

**Fix:** in the import path, treat "required field blank" as **skip + warn**, not a hard error
(or: drop rows where the mapped `name` column specifically is blank). Keep the hard error only
for the manual single-row forms.

### F5 — `guessColumn` maps every "Location" column to "Allocation %"  *(shipped auto-map bug)*
`ImportWizard.tsx` `guessColumn` does `alias.includes(header)` as a fallback, and
`"allocation".includes("location")` is `true`. So on any roster with a `Location` column, the
Assignments mapping silently pre-fills **Allocation % ← Location**. A user who doesn't catch it
imports garbage allocations; it also corrupted the harness's sheet-role scoring until worked
around.

**Fix:** require the substring match to be ≥ 4 chars *and* a prefix/suffix, or drop the
`alias.includes(header)` direction entirely (keep `header.includes(alias)`). Add a unit test
with `["Name","Team","Location"]` → assignments.

### F6 — `suggestDisciplineFromTitle` is off by default → empty disciplines
4 clean orgs imported with **0 disciplines** despite every person having a `Title`, because the
opt-in defaults off and the wizard only even *offers* it when no discipline column is mapped.
Per the ROADMAP, empty `disciplineId` quietly disables bus-factor / role-coverage / the pod
template. Consider: when no discipline maps, default the suggestion **on** with the preview
still shown (it's already non-destructive and reversible), or nudge harder in the UI.

### F7 — Same-name people are silently merged
`huge-clean-none`: 9,698 rows in → 9,630 people out. `commitImport` resolves people by name,
so two real "Chris Chen"s collapse into one (and the second's team/manager quietly wins).
No warning. At 10k headcount, name collisions are guaranteed. Needs at least a counted warning;
ideally a dedupe key (email / employee ID) — see F8.

### F8 — No stable identity column
Import matches people and teams **by name only**. No email / employee-ID / external-ID field
in `ImportPersonRow`. Consequences: F7 (collisions), re-import always duplicates or mis-merges,
and multi-file / multi-sheet resolution has nothing reliable to join on.

### F9 — Multi-file: no concept of it (expected — not built)
Each file imports independently. The 2nd file (teams-only, or contractors-only with columns
like `Contractor Name` / `Assigned Team` / `Bill Rate`) gets auto-detected as the wrong
entity. Cross-file resolution *does* work at the DB layer (`commitImport` pre-loads existing
rows), but only if the earlier file committed — and messy ones don't (F1). When you build
this: a single wizard session that ingests N files, classifies each (roster / structure /
contractor list), and commits once.

### F10 — Contractor patterns: the data model holds up
None of the six contractor shapes (lone / embedded / segregated pod / full offshore org /
mixed staff-aug + SOW) caused a structural failure *on their own* — `employment` normalization
and `isExternal`/`vendor` on teams did their job. The offshore and segregated orgs that failed
did so on F1/F3, not on anything contractor-specific. The `"Contractor (Infosys)"` →
`contractor` substring pass works well. **One gap:** a separate contractors file with its own
column vocabulary (`Agency`, `Bill Rate (monthly)`, `Onboarded`) auto-maps poorly and, being
a 2nd file, is mis-classified (F9).

### F11 — Scale is fine locally; watch it on Neon
~9,700 people + assignments commit in a single transaction in **~2.6 s** against local
Postgres. Linear, no cliff. But the production path runs inside a Vercel function against
pooled Neon with network round-trips per statement — if `commitImport` inserts row-by-row,
10k could approach the function timeout. Worth a batched-insert pass and a real Neon-branch
timing test before a large customer.

---

## Recommended order for vNext

1. **F1 `normalizeDate`** + stop hard-failing S1 fields on the import path — unblocks ~19 orgs, tiny change.
2. **F3 `normalizeKind`** + **F4 skip-junk-rows — unblocks the messy wizard-native orgs.
3. **F2 flat mode** — synthesize teams/groups/assignments from person columns. Unblocks 20 orgs; biggest UX win.
4. **F5 `guessColumn` fix** + unit test — quick, prevents silent data corruption.
5. **F8 identity column** (`email` / `externalId`) on people + teams — prerequisite for re-import, F7, and F9.
6. **F9 multi-file wizard** — the "resolving for that isn't built yet" item; do it after F8.
7. **F11** batched inserts + Neon timing.

After F1–F4 the corpus should go from **7/50 → ~30/50 landing with structure**, and the rest
landing as people-with-warnings instead of hard failures.

## Notes on method / limitations
- The wizard's sheet-guess + column auto-map is **copied** into the harness, not imported
  (it lives inside `ImportWizard.tsx` and isn't exported). Recommend extracting it to
  `lib/data/importSheet.ts` so wizard + tests share one implementation — the same reasoning
  that moved `commitImport` out of the server action.
- The harness models an "attentive user": when auto-detect finds no sheet, it assigns each
  sheet to its best-scoring entity. A real user could do better (or worse). "Pure auto-detect
  with zero clicks" is captured per-file in the JSON (`autoDetectedSheets`) and is emptier still.
- `suggestDisciplineFromTitle` was left **off** for every run (the shipped default).
