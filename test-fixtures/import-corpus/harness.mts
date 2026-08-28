/**
 * Import test harness — drives the REAL engine (lib/data/importCommit.ts)
 * against every fixture in scratchpad/orgs/, the same way ImportWizard.tsx would.
 *
 * The wizard's xlsx->payload step (sheet guessing + column auto-mapping) is not
 * exportable, so those functions are copied verbatim below. (See F5 / method
 * note in FINDINGS.md: extract them to lib/data/importSheet.ts.)
 *
 * HOW TO RUN (from the repo root, so tsconfig `@/` path aliases resolve):
 *   npx tsx test-fixtures/import-corpus/harness.mts            # all 50
 *   npx tsx test-fixtures/import-corpus/harness.mts 01 09 41   # by id prefix
 * Needs local Postgres up (DATABASE_URL in .env.local -> localhost:5432/zenhance).
 * Each org -> throwaway workspace -> commit -> record -> workspace deleted.
 * Writes results next to this file as results.json (gitignored).
 * Regenerate the corpus itself with:  python3 test-fixtures/import-corpus/gen_orgs.py
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../lib/db/schema";
import { commitImport, type Tx, type ImportPayload } from "../../lib/data/importCommit";

const ORGS = path.join(import.meta.dirname, "orgs");
const OUT = path.join(import.meta.dirname, "results.json");

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql, { schema });
const { workspaces } = schema;

// ---------------------------------------------------------------------------
// ---- verbatim copy from components/import/ImportWizard.tsx ------------------
// ---------------------------------------------------------------------------
type EntityKey = "people" | "teams" | "assignments";

const TARGETS: Record<EntityKey, { field: string; label: string; required?: boolean; aliases: string[] }[]> = {
  people: [
    { field: "name", label: "Name", required: true, aliases: ["name", "fullname", "person"] },
    { field: "title", label: "Title", aliases: ["title", "role", "position"] },
    { field: "costPerMonth", label: "Cost/month", aliases: ["cost", "costpermonth", "salary", "rate"] },
    { field: "skills", label: "Skills", aliases: ["skills", "skill", "tags"] },
    { field: "startDate", label: "Start date", aliases: ["startdate", "start", "hiredate", "tenure"] },
    { field: "growthFocus", label: "Growth focus", aliases: ["growth", "growthfocus", "development"] },
    { field: "lastVacationAt", label: "Last vacation", aliases: ["lastvacation", "vacation", "pto"] },
    { field: "manager", label: "Manager (by name)", aliases: ["manager", "reportsto", "reportsTo", "boss", "supervisor"] },
    { field: "discipline", label: "Discipline", aliases: ["discipline", "craft", "function", "jobfamily", "profession", "specialty", "capability"] },
    { field: "employment", label: "Employment type", aliases: ["employment", "employmenttype", "workertype", "employeetype", "contracttype", "fte", "staffingtype"] },
    { field: "location", label: "Location", aliases: ["location", "office", "site", "city", "country", "basedin"] },
    { field: "timezone", label: "Timezone", aliases: ["timezone", "tz", "zone", "utcoffset", "workinghours"] },
  ],
  teams: [
    { field: "name", label: "Name", required: true, aliases: ["name", "team", "unit", "group"] },
    { field: "kind", label: "Kind (team/group)", aliases: ["kind", "type", "level"] },
    { field: "parent", label: "Parent (by name)", aliases: ["parent", "parentteam", "reportsto"] },
    { field: "lead", label: "Lead (by name)", aliases: ["lead", "manager", "teamlead", "owner"] },
    { field: "targetHeadcount", label: "Target headcount", aliases: ["target", "headcount", "targetheadcount", "capacity"] },
    { field: "isExternal", label: "External?", aliases: ["external", "contractor", "isexternal"] },
    { field: "vendor", label: "Vendor", aliases: ["vendor", "supplier", "firm"] },
    { field: "costPerMonth", label: "Cost/month", aliases: ["cost", "costpermonth"] },
    { field: "expectedRoi", label: "Expected ROI", aliases: ["roi", "expectedroi", "value"] },
  ],
  assignments: [
    { field: "person", label: "Person (by name)", aliases: ["person", "name", "member"] },
    { field: "team", label: "Team (by name)", required: true, aliases: ["team", "unit", "assignedto"] },
    { field: "role", label: "Role", aliases: ["role", "position"] },
    { field: "allocationPct", label: "Allocation %", aliases: ["allocation", "alloc", "percent", "allocationpct"] },
    { field: "isOpenRole", label: "Open role?", aliases: ["open", "openrole", "isopenrole", "vacant"] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function guessColumn(headers: string[], aliases: string[]): string {
  const normed = headers.map((h) => ({ h, n: norm(h) }));
  for (const a of aliases) {
    const exact = normed.find((x) => x.n === a);
    if (exact) return exact.h;
  }
  for (const a of aliases) {
    const partial = normed.find((x) => x.n.includes(a) || a.includes(x.n));
    if (partial) return partial.h;
  }
  return "";
}

type Sheet = { name: string; headers: string[]; rows: Record<string, string>[] };

function guessSheet(sheets: Sheet[], key: EntityKey): string {
  const want = key.replace(/s$/, "");
  const match = sheets.find((s) => norm(s.name).includes(want));
  return match?.name ?? "";
}

function parseWorkbook(buf: Buffer): Sheet[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
    const headerRow = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" })[0] ?? [];
    const headers = (headerRow as string[]).filter((h) => h !== "");
    return { name, headers, rows };
  });
}

function buildPayload(
  sheets: Sheet[],
  sheetChoice: Record<EntityKey, string>,
  mapping: Record<EntityKey, Record<string, string>>,
  suggestFromTitle: boolean,
): ImportPayload {
  const extract = (key: EntityKey) => {
    const sheet = sheets.find((s) => s.name === sheetChoice[key]);
    if (!sheet) return [];
    const map = mapping[key];
    return sheet.rows
      .map((row) => {
        const obj: Record<string, string> = {};
        for (const t of TARGETS[key]) {
          const col = map[t.field];
          obj[t.field] = col ? String(row[col] ?? "").trim() : "";
        }
        return obj;
      })
      .filter((o) => Object.values(o).some((v) => v !== ""));
  };
  return {
    people: extract("people") as ImportPayload["people"],
    teams: extract("teams") as ImportPayload["teams"],
    assignments: extract("assignments") as ImportPayload["assignments"],
    suggestDisciplineFromTitle: suggestFromTitle,
  };
}

// ---------------------------------------------------------------------------
// ---- harness --------------------------------------------------------------
// ---------------------------------------------------------------------------
type FileRun = {
  file: string;
  autoDetectedSheets: Record<EntityKey, string>;
  usedSheets: Record<EntityKey, string>;
  assisted: boolean;
  autoMappedColumns: Record<EntityKey, Record<string, string>>;
  unmappedRequired: string[];
  payloadCounts: { people: number; teams: number; assignments: number };
  ms: number;
  result:
    | { ok: true; created: any; warnings: string[] }
    | { ok: false; errors: any[]; errorSample: string[] };
};

type OrgRun = {
  id: string;
  files: string[];
  runs: FileRun[];
  finalDb: { people: number; teams: number; assignments: number; disciplines: number };
  verdict: string;
};

/** Fraction of an entity's targets a sheet's headers can satisfy (required must hit). */
function sheetScore(sheet: Sheet, key: EntityKey): number {
  const ts = TARGETS[key];
  let hit = 0;
  for (const t of ts) {
    const col = guessColumn(sheet.headers, t.aliases);
    if (t.required && !col) return -1;
    if (col) hit++;
  }
  return hit / ts.length;
}

function assistedSheetChoice(sheets: Sheet[]): { choice: Record<EntityKey, string>; assisted: boolean } {
  const auto: Record<EntityKey, string> = {
    people: guessSheet(sheets, "people"),
    teams: guessSheet(sheets, "teams"),
    assignments: guessSheet(sheets, "assignments"),
  };
  if (auto.people || auto.teams || auto.assignments) return { choice: auto, assisted: false };

  // Auto-detect found nothing (flat dump / oddly-named sheets). Model an
  // attentive user: give each sheet to the single entity it scores best for,
  // as long as that beats a floor. A person-roster sheet wins "people";
  // a teams sheet with a name+parent wins "teams"; etc.
  const choice: Record<EntityKey, string> = { people: "", teams: "", assignments: "" };
  const taken = new Set<string>();
  const pairs: { key: EntityKey; sheet: string; score: number }[] = [];
  for (const s of sheets)
    for (const key of Object.keys(TARGETS) as EntityKey[]) {
      const sc = sheetScore(s, key);
      if (sc >= 0.34) pairs.push({ key, sheet: s.name, score: sc });
    }
  // A roster sheet (discipline/manager/timezone present) is People, not an
  // Assignments list — even when guessColumn's "allocation"⊃"location" false
  // positive inflates the assignments score. Model the user's obvious call.
  const rosterSheets = new Set(pairs.filter((p) => p.key === "people" && p.score >= 0.4).map((p) => p.sheet));
  const filtered = pairs.filter((p) => !(p.key === "assignments" && rosterSheets.has(p.sheet)));
  filtered.sort((a, b) => b.score - a.score);
  pairs.length = 0;
  pairs.push(...filtered);
  if (process.env.DBG) console.error("PAIRS", JSON.stringify(pairs));
  for (const p of pairs) {
    if (choice[p.key] || taken.has(p.sheet)) continue;
    choice[p.key] = p.sheet;
    taken.add(p.sheet);
  }
  return { choice, assisted: true };
}

function autoMap(sheets: Sheet[], choice: Record<EntityKey, string>) {
  const mp: Record<EntityKey, Record<string, string>> = { people: {}, teams: {}, assignments: {} };
  (Object.keys(TARGETS) as EntityKey[]).forEach((key) => {
    const sheet = sheets.find((s) => s.name === choice[key]);
    if (!sheet) return;
    for (const t of TARGETS[key]) mp[key][t.field] = guessColumn(sheet.headers, t.aliases);
  });
  return mp;
}

async function runOrg(id: string, dir: string): Promise<OrgRun> {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx")).sort();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `IMPORT TEST ${id}`, ownerUserId: `import-harness-${id}-${Date.now()}` })
    .returning();
  const wid = ws.id;
  const runs: FileRun[] = [];

  try {
    for (const file of files) {
      const buf = fs.readFileSync(path.join(dir, file));
      const sheets = parseWorkbook(buf);
      const auto: Record<EntityKey, string> = {
        people: guessSheet(sheets, "people"),
        teams: guessSheet(sheets, "teams"),
        assignments: guessSheet(sheets, "assignments"),
      };
      const { choice, assisted } = assistedSheetChoice(sheets);
      const mapping = autoMap(sheets, choice);

      const unmappedRequired: string[] = [];
      (Object.keys(TARGETS) as EntityKey[]).forEach((key) => {
        if (!choice[key]) return;
        for (const t of TARGETS[key]) {
          if (t.required && !mapping[key][t.field]) unmappedRequired.push(`${key}.${t.field}`);
        }
      });

      const noDiscipline = !mapping.people.discipline && !!mapping.people.title;
      const payload = buildPayload(sheets, choice, mapping, false /* default: opt-in is OFF */);

      const t0 = performance.now();
      let result: FileRun["result"];
      try {
        const r = await db.transaction(async (tx) => commitImport(tx as Tx, wid, payload));
        if (r.ok) result = { ok: true, created: r.created, warnings: r.warnings };
        else
          result = {
            ok: false,
            errors: r.errors,
            errorSample: [...new Set(r.errors.map((e) => `${e.sheet}: ${e.message}`))].slice(0, 8),
          };
      } catch (e: any) {
        result = { ok: false, errors: [], errorSample: [`THREW: ${e.message ?? e}`] };
      }
      const ms = Math.round(performance.now() - t0);

      runs.push({
        file,
        autoDetectedSheets: auto,
        usedSheets: choice,
        assisted,
        autoMappedColumns: mapping,
        unmappedRequired,
        payloadCounts: {
          people: payload.people.length,
          teams: payload.teams.length,
          assignments: payload.assignments.length,
        },
        ms,
        result,
      });
      if (noDiscipline) (runs[runs.length - 1] as any).noDisciplineColumn = true;
    }

    const count = async (t: any) =>
      Number((await db.select().from(t).where(eq(t.workspaceId, wid))).length);
    const finalDb = {
      people: await count(schema.people),
      teams: await count(schema.orgUnits),
      assignments: await count(schema.assignments),
      disciplines: await count(schema.disciplines),
    };

    const anyOk = runs.some((r) => r.result.ok);
    const allOk = runs.every((r) => r.result.ok);
    const verdict = allOk
      ? finalDb.people === 0
        ? "committed but EMPTY (mapping produced no rows)"
        : "ok"
      : anyOk
        ? "partial (some files failed)"
        : "FAILED (no file imported)";

    return { id, files, runs, finalDb, verdict };
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, wid));
  }
}

async function main() {
  const filter = process.argv.slice(2);
  const ids = fs
    .readdirSync(ORGS)
    .filter((d) => fs.statSync(path.join(ORGS, d)).isDirectory())
    .filter((d) => filter.length === 0 || filter.some((f) => d.startsWith(f)))
    .sort();

  const results: OrgRun[] = [];
  for (const id of ids) {
    process.stdout.write(`${id} … `);
    try {
      const r = await runOrg(id, path.join(ORGS, id));
      results.push(r);
      const tot = r.runs.reduce((a, x) => a + x.ms, 0);
      console.log(`${r.verdict}  [${r.finalDb.people}p/${r.finalDb.teams}t/${r.finalDb.assignments}a/${r.finalDb.disciplines}d, ${tot}ms]`);
    } catch (e: any) {
      console.log(`ERROR ${e.message ?? e}`);
      results.push({ id, files: [], runs: [], finalDb: { people: 0, teams: 0, assignments: 0, disciplines: 0 }, verdict: `HARNESS ERROR: ${e.message ?? e}` });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${OUT}`);

  // quick console summary
  const by = (v: (r: OrgRun) => boolean) => results.filter(v).map((r) => r.id);
  console.log("\n=== summary ===");
  console.log("ok           :", by((r) => r.verdict === "ok").length);
  console.log("empty commit :", by((r) => r.verdict.startsWith("committed but EMPTY")).join(", ") || "—");
  console.log("partial      :", by((r) => r.verdict.startsWith("partial")).join(", ") || "—");
  console.log("failed       :", by((r) => r.verdict.startsWith("FAILED")).join(", ") || "—");
  console.log("harness error:", by((r) => r.verdict.startsWith("HARNESS")).join(", ") || "—");

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
