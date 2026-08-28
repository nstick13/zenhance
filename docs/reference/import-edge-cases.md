# Import edge cases — 50-org corpus test (2026-08-27)

A synthetic corpus of 50 fake orgs (88 `.xlsx` files, ~10 to ~9,700 people) was run through
the **real** import engine (`commitImport` from `lib/data/importCommit.ts`) to map how ~50
different customers' data would actually land. This is the durable summary; the full writeup,
raw results, the corpus generator and the test harness live outside the repo in the scratchpad
(`IMPORT-FINDINGS.md`, `import-results.json`, `gen_orgs.py`, `import_harness.mts`) — ask Nate
if you need them re-generated.

## What the corpus varies
size (tiny ~10 · small ~60 · medium ~300 · large ~1.8k · huge ~10k) · tidiness (clean vs
messy: HRIS headers, free-text vocab, junk footer rows, orphan refs, dup rows, non-ISO dates) ·
shape (flat one-sheet HRIS dump vs wizard-native People/Teams/Assignments) · contractors (none ·
one lone · embedded · segregated vendor pod · full offshore org · mixed staff-aug + SOW) ·
files (single vs multi-file handover).

## Outcome

| | orgs | who |
|---|---|---|
| people **+ teams + assignments** landed | **7 / 50** | clean **wizard-native** workbooks only |
| people landed, **hierarchy + memberships silently lost** | **20 / 50** | every clean **flat** HRIS dump |
| **hard-failed, nothing committed** | **19 / 50** | every messy org with a date column |
| net-empty ("partial") | **4 / 50** | messy multi-file |

Two gates decide everything: **(1)** is it a wizard-native 3-sheet workbook (else you lose all
structure), and **(2)** does it have a date column with real-world formatting (else the whole
import is rejected). Every messy org failed; no clean org failed but most came in structureless.

## The findings (priority order)

1. **Non-ISO dates roll back the entire import.** `lib/validation.ts` `optionalDate` is
   `/^\d{4}-\d{2}-\d{2}$/`; the import path runs every row through `personInput.safeParse`, so
   one `3/1/2021` / `Q1 2021` / `2021` / Excel-serial / typed-blank aborts the transaction.
   → `normalizeDate()` in `importMapping.ts` (parse common shapes → ISO or `null` + counted
   warning), applied before validation. Same contract as `normalizeTimezone`.

2. **Team `kind` is a strict `enum(["group","team"])`.** `Squad`/`Tribe`/`Chapter`/`Pod`/
   `Dept`/`Division` → `ImportError` → rollback. → `normalizeKind()`, same pattern as
   `normalizeEmployment`.

3. **Trailing junk rows fail as "Name is required".** The wizard drops a row only if *every*
   mapped cell is blank; a `Total | | | 250` or `Note: …` footer has text in a non-name
   column, survives, and hard-fails on the empty name. → on the import path, "required field
   blank" should be skip + warn, not a fatal error (keep fatal for the manual single-row forms).

4. **Flat HRIS dumps lose all org structure (20 orgs).** No path to synthesise org units +
   memberships from a person table's `Department`/`Team`/`Manager` columns — `guessSheet` only
   matches sheets literally named ~people/team/assignment, and the person's `team` (already in
   `ImportPersonRow`) is dropped. → **flat mode**: when only People is mapped and it carries a
   team column, create one `orgUnit` per team, a parent `group` per department, and a 100%
   `assignment` per person.

5. **`guessColumn` maps every *Location* column to *Allocation %*.** `ImportWizard.tsx`
   `guessColumn` falls back to `alias.includes(header)`, and `"allocation".includes("location")`
   is `true`. Silent bad-data path. → require ≥4-char prefix/suffix match, or drop the
   `alias.includes(header)` direction; add a `["Name","Team","Location"]` unit test.

6. **Same-name people are silently merged.** `huge-clean-none`: 9,698 rows → 9,630 people,
   no warning (second row's team/manager wins). Name is the only match key.

7. **No stable identity column.** No `email` / `externalId` on people or teams → re-import
   duplicates or mis-merges, and multi-file joins have nothing reliable. Prerequisite for #6
   and #8.

8. **Multi-file: not a concept.** Each file imports independently and the 2nd (teams-only, or a
   contractor list with columns like `Agency` / `Bill Rate (monthly)`) is auto-classified as
   the wrong entity. Cross-file resolution works at the DB layer (`commitImport` pre-loads
   existing rows) but only if the earlier file committed. → one wizard session, N files,
   classify each, commit once.

9. **`suggestDisciplineFromTitle` off by default** → 4 clean orgs imported with 0 disciplines
   despite every person having a title (disables bus-factor / role-coverage / pod template).
   Consider defaulting it on (preview still shown; it's non-destructive) when no discipline maps.

10. **Contractor data model holds up.** None of the six contractor shapes caused a structural
    failure on their own; `normalizeEmployment` + `isExternal`/`vendor` did their job. The
    offshore/segregated orgs that failed did so on #1/#2.

11. **Scale:** ~9,700 people + assignments commit in ~2.6 s on local Postgres, linear. But the
    prod path is a Vercel function against pooled Neon — if `commitImport` inserts row-by-row,
    10k could approach the timeout. Batch the inserts; time it against a real Neon branch.

## Projected effect
After findings 1–3 the corpus should move from **7/50 → ~30/50** landing with structure, and the
rest landing as *people + warnings* instead of hard failures. Finding 4 recovers the remaining
flat-dump orgs.

## Method note
The wizard's sheet-guess + column auto-map lives inside `ImportWizard.tsx` and isn't exported,
so the harness copies it verbatim — extract it to `lib/data/importSheet.ts` so the wizard and
tests share one implementation (same reasoning that moved `commitImport` out of the server
action). The harness models an "attentive user" who assigns each sheet to its best-scoring
entity when auto-detect finds nothing; zero-click auto-detect is even emptier.
