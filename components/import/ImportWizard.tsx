"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  importOrg,
  type ImportResult,
  type ImportPayload,
} from "@/lib/data/import";

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
  "rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-fuchsia-500";

export function ImportWizard() {
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
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
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
    };
  }

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
        <label className="cursor-pointer rounded-md bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-400">
          Choose file
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFile}
          />
        </label>
        {fileName && <span className="text-sm text-slate-400">{fileName}</span>}
        <button
          onClick={downloadTemplate}
          className="ml-auto rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
        >
          Download template
        </button>
      </div>

      {sheets.length > 0 && (
        <div className="space-y-5">
          {(Object.keys(TARGETS) as EntityKey[]).map((key) => {
            const sheet = sheets.find((s) => s.name === sheetChoice[key]);
            return (
              <div key={key} className="rounded-lg border border-slate-800 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-medium capitalize">{key}</h3>
                  <label className="text-sm text-slate-400">
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
                        <span className="mb-1 block text-slate-400">
                          {t.label}
                          {t.required && <span className="text-fuchsia-400"> *</span>}
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
                  <p className="text-sm text-slate-500">Not importing {key}.</p>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <button
              onClick={runImport}
              disabled={pending}
              className="rounded-md bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50"
            >
              {pending ? "Importing…" : "Import"}
            </button>
            {result?.ok && (
              <span className="text-sm text-emerald-400">
                Imported {result.created.people} people, {result.created.teams} teams,{" "}
                {result.created.assignments} assignments.
              </span>
            )}
          </div>

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
    { name: "Sarah Reeve", title: "Delivery Lead", costPerMonth: 14500, skills: "Leadership, SAFe", startDate: "2019-02-01", growthFocus: "Org design", lastVacationAt: "" },
    { name: "Aimee Bradford", title: "Team Lead", costPerMonth: 11200, skills: "Java, Architecture", startDate: "2020-06-15", growthFocus: "", lastVacationAt: "2024-10-01" },
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
