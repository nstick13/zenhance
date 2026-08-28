# Import test corpus

50 synthetic orgs (88 `.xlsx` files, ~10 → ~9,700 people) for exercising the importer, plus the
generator that made them and a harness that drives the **real** engine (`lib/data/importCommit.ts`)
over all of them.

Not part of the `vitest` suite — it needs local Postgres and takes ~20s. Run it deliberately.

## Files
- **`orgs/`** — the fixtures, one folder per org (`01-tiny-clean-none/` … `50-huge-messy-segregated/`),
  with `orgs/MANIFEST.json` + `orgs/README.md` describing each org's intended edge cases.
- **`gen_orgs.py`** — regenerates `orgs/` (seeded, reproducible). Needs `openpyxl`.
- **`harness.mts`** — imports each fixture into a throwaway workspace via the real `commitImport`,
  records counts/warnings/timing, deletes the workspace. Writes `results.json` (gitignored).
- **`FINDINGS.md`** — the writeup of the last run. Durable summary also lives at
  [docs/reference/import-edge-cases.md](../../docs/reference/import-edge-cases.md).

## Run
```bash
# regenerate the fixtures (optional — they're committed)
python3 test-fixtures/import-corpus/gen_orgs.py

# run the harness (needs local Postgres: DATABASE_URL -> localhost:5432/zenhance)
npx tsx test-fixtures/import-corpus/harness.mts            # all 50
npx tsx test-fixtures/import-corpus/harness.mts 01 09 41   # by id prefix
```

## Axes covered
size (tiny ~10 · small ~60 · medium ~300 · large ~1.8k · huge ~10k) · tidiness (clean vs messy:
HRIS headers, free-text vocab, junk footer rows, orphan refs, dup rows, non-ISO dates) · shape
(flat one-sheet HRIS dump vs wizard-native People/Teams/Assignments) · contractors (none · one lone
· embedded · segregated vendor pod · full offshore org · mixed staff-aug + SOW) · files (single vs
multi-file handover).

This is also the eval set for the AI-ingestion work (ROADMAP S2): grade any AI mapper against it,
with the orgs that already pass as a regression guard.
