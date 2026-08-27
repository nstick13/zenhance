"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  importOrg,
  type ImportResult,
  type ImportPayload,
} from "@/lib/data/import";
import {
  previewDisciplineSuggestions,
  type DisciplineSuggestionPreview,
} from "@/lib/data/importMapping";

type Sheet = { name: string; headers: string[]; rows: Record<string, string>[] };

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

function guessSheet(sheets: Sheet[], key: EntityKey): string {
  const want = key.replace(/s$/, "");
  const match = sheets.find((s) => norm(s.name).includes(want));
  return match?.name ?? "";
}

const field =
  "rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-ink";

export function ImportWizard({ knownDisciplines = [] }: { knownDisciplines?: string[] }) {
  const router = useRouter();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [fileName, setFileName] = useState("");
  const [sheetChoice, setSheetChoice] = useState<Record<EntityKey, string>>({
    people: "",
    teams: "",
    assignments: "",
  });
  const [mapping, setMapping] = useState<Record<EntityKey, Record<string, string>>>({
    people: {},
    teams: {},
    assignments: {},
  });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [suggestFromTitle, setSuggestFromTitle] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setSuggestFromTitle(false);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const parsed: Sheet[] = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
      const headerRow = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" })[0] ?? [];
      const headers = (headerRow as string[]).filter((h) => h !== "");
      return { name, headers, rows };
    });
    setSheets(parsed);

    const sc: Record<EntityKey, string> = {
      people: guessSheet(parsed, "people"),
      teams: guessSheet(parsed, "teams"),
      assignments: guessSheet(parsed, "assignments"),
    };
    setSheetChoice(sc);

    const mp: Record<EntityKey, Record<string, string>> = { people: {}, teams: {}, assignments: {} };
    (Object.keys(TARGETS) as EntityKey[]).forEach((key) => {
      const sheet = parsed.find((s) => s.name === sc[key]);
      if (!sheet) return;
      for (const t of TARGETS[key]) {
        mp[key][t.field] = guessColumn(sheet.headers, t.aliases);
      }
    });
    setMapping(mp);
  }

  function setSheetFor(key: EntityKey, name: string) {
    setSheetChoice((prev) => ({ ...prev, [key]: name }));
    const sheet = sheets.find((s) => s.name === name);
    setMapping((prev) => ({
      ...prev,
      [key]: Object.fromEntries(
        TARGETS[key].map((t) => [t.field, sheet ? guessColumn(sheet.headers, t.aliases) : ""]),
      ),
    }));
  }

  function buildPayload(): ImportPayload {
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

  /**
   * S2's reason for existing: most orgs' exports carry a title and no
   * discipline, and an empty discipline quietly disables half the findings
   * (bus factor, role coverage, the pod template). So when the discipline
   * column is missing but a title column isn't, offer to read one from the
   * other — and show exactly what that would create first.
   */
  const suggestion = useMemo<{ preview: DisciplineSuggestionPreview; total: number } | null>(() => {
    const sheet = sheets.find((s) => s.name === sheetChoice.people);
    const titleCol = mapping.people?.title;
    if (!sheet || !titleCol || mapping.people?.discipline) return null;
    const titles = sheet.rows.map((r) => String(r[titleCol] ?? "").trim()).filter(Boolean);
    if (titles.length === 0) return null;
    return { preview: previewDisciplineSuggestions(titles, knownDisciplines), total: titles.length };
  }, [sheets, sheetChoice.people, mapping.people, knownDisciplines]);

  function runImport() {
    setResult(null);
    const payload = buildPayload();
    startTransition(async () => {
      const res = await importOrg(payload);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft">
          Choose file
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFile}
          />
        </label>
        {fileName && <span className="text-sm text-ink-soft">{fileName}</span>}
        <button
          onClick={downloadTemplate}
          className="ml-auto rounded-md border border-line px-3 py-2 text-sm hover:bg-paper"
        >
          Download template
        </button>
      </div>

      {sheets.length > 0 && (
        <div className="space-y-5">
          {(Object.keys(TARGETS) as EntityKey[]).map((key) => {
            const sheet = sheets.find((s) => s.name === sheetChoice[key]);
            return (
              <div key={key} className="rounded-lg border border-line p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-medium capitalize">{key}</h3>
                  <label className="text-sm text-ink-soft">
                    Sheet:{" "}
                    <select
                      className={field}
                      value={sheetChoice[key]}
                      onChange={(e) => setSheetFor(key, e.target.value)}
                    >
                      <option value="">— skip —</option>
                      {sheets.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name} ({s.rows.length})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {sheet ? (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
                    {TARGETS[key].map((t) => (
                      <label key={t.field} className="text-sm">
                        <span className="mb-1 block text-ink-soft">
                          {t.label}
                          {t.required && <span className="text-grow"> *</span>}
                        </span>
                        <select
                          className={`${field} w-full`}
                          value={mapping[key][t.field] ?? ""}
                          onChange={(e) =>
                            setMapping((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], [t.field]: e.target.value },
                            }))
                          }
                        >
                          <option value="">— none —</option>
                          {sheet.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-ink-soft">Not importing {key}.</p>
                )}

                {key === "people" && sheet && suggestion && (
                  <div className="mt-4 rounded-md border border-line bg-paper p-3">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={suggestFromTitle}
                        onChange={(e) => setSuggestFromTitle(e.target.checked)}
                      />
                      <span className="text-sm">
                        <span className="font-medium">Read discipline from title</span>
                        <span className="text-ink-soft">
                          {" "}
                          — no discipline column is mapped. Without one, colour-by-discipline,
                          bus factor and role coverage stay empty.
                        </span>
                      </span>
                    </label>

                    <p className="mt-2 text-sm text-ink-soft">
                      Would fill{" "}
                      <span className="font-medium text-ink">
                        {suggestion.preview.matched} of {suggestion.total}
                      </span>{" "}
                      people
                      {suggestion.preview.unmatched > 0 && (
                        <> · {suggestion.preview.unmatched} left empty</>
                      )}
                      .
                    </p>

                    {suggestion.preview.byDiscipline.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {suggestion.preview.byDiscipline.map((d) => (
                          <li key={d.name} className="text-ink-soft">
                            <span className="text-ink">{d.name}</span> {d.count}
                            {d.isNew && <span className="text-grow"> · new</span>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {suggestion.preview.sampleMisses.length > 0 && (
                      <p className="mt-2 text-sm text-ink-soft">
                        Not matched, e.g.: {suggestion.preview.sampleMisses.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <button
              onClick={runImport}
              disabled={pending}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {pending ? "Importing…" : "Import"}
            </button>
            {result?.ok && (
              <span className="text-sm text-grow">
                Imported {result.created.people} people, {result.created.teams} teams,{" "}
                {result.created.assignments} assignments
                {result.created.disciplines > 0 && (
                  <> · created {result.created.disciplines} discipline(s)</>
                )}
                .
              </span>
            )}
          </div>

          {result?.ok && result.warnings.length > 0 && (
            <div className="rounded-lg border border-line bg-paper p-4">
              <p className="mb-2 text-sm font-medium">Imported, with gaps:</p>
              <ul className="space-y-1 text-sm text-ink-soft">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result && !result.ok && (
            <div className="rounded-lg border border-red-900 bg-red-950/40 p-4">
              <p className="mb-2 text-sm font-medium text-red-300">
                {result.errors.length} problem(s) — nothing was imported:
              </p>
              <ul className="max-h-48 space-y-1 overflow-auto text-sm text-red-300/90">
                {result.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    {e.sheet} row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const people = [
    { name: "Sarah Reeve", title: "Delivery Lead", discipline: "Delivery", employment: "FTE", location: "London", timezone: "Europe/London", costPerMonth: 14500, skills: "Leadership, SAFe", startDate: "2019-02-01", growthFocus: "Org design", lastVacationAt: "" },
    { name: "Aimee Bradford", title: "Team Lead", discipline: "Engineering", employment: "Contractor", location: "Austin", timezone: "America/Chicago", costPerMonth: 11200, skills: "Java, Architecture", startDate: "2020-06-15", growthFocus: "", lastVacationAt: "2024-10-01" },
  ];
  const teams = [
    { name: "Delivery Group", kind: "group", parent: "", lead: "Sarah Reeve", targetHeadcount: "", isExternal: "", vendor: "", costPerMonth: "", expectedRoi: 12500000 },
    { name: "Starlight", kind: "team", parent: "Delivery Group", lead: "Aimee Bradford", targetHeadcount: 6, isExternal: "", vendor: "", costPerMonth: "", expectedRoi: 4200000 },
  ];
  const assignments = [
    { person: "Aimee Bradford", team: "Starlight", role: "Team Lead", allocationPct: 100, isOpenRole: "" },
    { person: "", team: "Starlight", role: "Engineer", allocationPct: 100, isOpenRole: "yes" },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(people), "People");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teams), "Teams");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(assignments), "Assignments");
  XLSX.writeFile(wb, "zenhance-template.xlsx");
}
