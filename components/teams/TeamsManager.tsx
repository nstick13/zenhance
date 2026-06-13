"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrgUnit, Person, Assignment } from "@/lib/db/schema";
import {
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  createAssignment,
  deleteAssignment,
} from "@/lib/data/actions";

const field =
  "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fuchsia-500";

type UnitForm = {
  name: string;
  kind: "group" | "team";
  parentId: string;
  leadPersonId: string;
  targetHeadcount: string;
  isExternal: boolean;
  vendorName: string;
  costPerMonth: string;
  expectedRoi: string;
};

const emptyUnit: UnitForm = {
  name: "",
  kind: "team",
  parentId: "",
  leadPersonId: "",
  targetHeadcount: "",
  isExternal: false,
  vendorName: "",
  costPerMonth: "",
  expectedRoi: "",
};

function unitToForm(u: OrgUnit): UnitForm {
  return {
    name: u.name,
    kind: u.kind,
    parentId: u.parentId ?? "",
    leadPersonId: u.leadPersonId ?? "",
    targetHeadcount: u.targetHeadcount?.toString() ?? "",
    isExternal: u.isExternal,
    vendorName: u.vendorName ?? "",
    costPerMonth: u.costPerMonth ?? "",
    expectedRoi: u.expectedRoi ?? "",
  };
}

/** Depth-first ordering with indentation depth for a parentId tree. */
function orderTree(units: OrgUnit[]): { unit: OrgUnit; depth: number }[] {
  const byParent = new Map<string | null, OrgUnit[]>();
  for (const u of units) {
    const key = u.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(u);
  }
  for (const list of byParent.values())
    list.sort((a, b) => a.name.localeCompare(b.name));
  const out: { unit: OrgUnit; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const u of byParent.get(parentId) ?? []) {
      out.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function TeamsManager({
  units,
  people,
  assignments,
}: {
  units: OrgUnit[];
  people: Person[];
  assignments: Assignment[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    units[0]?.id ?? null,
  );
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState(false);
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnit);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ordered = useMemo(() => orderTree(units), [units]);
  const peopleById = useMemo(
    () => Object.fromEntries(people.map((p) => [p.id, p])),
    [people],
  );
  const selected = units.find((u) => u.id === selectedId) ?? null;
  const selectedAssignments = assignments.filter(
    (a) => a.orgUnitId === selectedId,
  );

  function openCreateUnit() {
    setUnitForm({ ...emptyUnit, parentId: selectedId ?? "" });
    setEditingUnit(false);
    setShowUnitForm(true);
    setError(null);
  }
  function openEditUnit() {
    if (!selected) return;
    setUnitForm(unitToForm(selected));
    setEditingUnit(true);
    setShowUnitForm(true);
    setError(null);
  }

  function submitUnit() {
    setError(null);
    startTransition(async () => {
      const payload = { ...unitForm };
      const res =
        editingUnit && selected
          ? await updateOrgUnit(selected.id, payload)
          : await createOrgUnit(payload);
      if (!res.ok) return setError(res.error);
      setShowUnitForm(false);
      router.refresh();
    });
  }

  function removeUnit() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}" and everything under it?`)) return;
    startTransition(async () => {
      await deleteOrgUnit(selected.id);
      setSelectedId(null);
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-[300px_1fr] gap-6">
      {/* Tree */}
      <div className="rounded-lg border border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
          <span className="text-sm font-medium text-slate-300">Structure</span>
          <button
            onClick={openCreateUnit}
            className="rounded bg-fuchsia-500 px-2 py-1 text-xs font-medium text-white hover:bg-fuchsia-400"
          >
            + Unit
          </button>
        </div>
        <ul className="py-1">
          {ordered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm">
              <p className="text-slate-500">No teams yet.</p>
              <p className="mt-1 text-xs text-slate-600">
                Create one above, or{" "}
                <a href="/import" className="text-fuchsia-400 hover:underline">
                  import a spreadsheet
                </a>
                .
              </p>
            </li>
          )}
          {ordered.map(({ unit, depth }) => (
            <li key={unit.id}>
              <button
                onClick={() => setSelectedId(unit.id)}
                style={{ paddingLeft: 12 + depth * 16 }}
                className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-slate-800 ${
                  unit.id === selectedId ? "bg-slate-800 text-fuchsia-300" : "text-slate-300"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    unit.kind === "group" ? "bg-indigo-400" : "bg-fuchsia-400"
                  }`}
                />
                {unit.name}
                {unit.isExternal && (
                  <span className="ml-1 rounded bg-amber-500/10 px-1 text-[10px] text-amber-400">
                    ext
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Detail */}
      <div className="space-y-6">
        {showUnitForm && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="mb-3 font-medium">
              {editingUnit ? "Edit unit" : "New unit"}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Name *</span>
                <input
                  className={field}
                  value={unitForm.name}
                  onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Kind</span>
                <select
                  className={field}
                  value={unitForm.kind}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, kind: e.target.value as "group" | "team" })
                  }
                >
                  <option value="team">Team</option>
                  <option value="group">Group (team of teams)</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Parent</span>
                <select
                  className={field}
                  value={unitForm.parentId}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, parentId: e.target.value })
                  }
                >
                  <option value="">— none (root) —</option>
                  {units
                    .filter((u) => !editingUnit || u.id !== selected?.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Lead</span>
                <select
                  className={field}
                  value={unitForm.leadPersonId}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, leadPersonId: e.target.value })
                  }
                >
                  <option value="">— none —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Target headcount</span>
                <input
                  className={field}
                  inputMode="numeric"
                  value={unitForm.targetHeadcount}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, targetHeadcount: e.target.value })
                  }
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Expected ROI ($)</span>
                <input
                  className={field}
                  inputMode="decimal"
                  value={unitForm.expectedRoi}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, expectedRoi: e.target.value })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={unitForm.isExternal}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, isExternal: e.target.checked })
                  }
                />
                <span className="text-slate-400">External / contractor team</span>
              </label>
              {unitForm.isExternal && (
                <label className="text-sm">
                  <span className="mb-1 block text-slate-400">Vendor</span>
                  <input
                    className={field}
                    value={unitForm.vendorName}
                    onChange={(e) =>
                      setUnitForm({ ...unitForm, vendorName: e.target.value })
                    }
                  />
                </label>
              )}
              <label className="text-sm">
                <span className="mb-1 block text-slate-400">Unit cost / month ($)</span>
                <input
                  className={field}
                  inputMode="decimal"
                  value={unitForm.costPerMonth}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, costPerMonth: e.target.value })
                  }
                />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={submitUnit}
                disabled={pending}
                className="rounded-md bg-fuchsia-500 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50"
              >
                {pending ? "Saving…" : editingUnit ? "Save changes" : "Create unit"}
              </button>
              <button
                onClick={() => setShowUnitForm(false)}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {selected ? (
          <div className="rounded-lg border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                <p className="text-xs text-slate-400">
                  {selected.kind === "group" ? "Group" : "Team"}
                  {selected.leadPersonId &&
                    ` · Lead: ${peopleById[selected.leadPersonId]?.name ?? "—"}`}
                  {selected.targetHeadcount != null &&
                    ` · Target: ${selected.targetHeadcount}`}
                </p>
              </div>
              <div className="flex gap-2 text-sm">
                <button onClick={openEditUnit} className="text-slate-400 hover:text-slate-100">
                  Edit
                </button>
                <button onClick={removeUnit} className="text-slate-500 hover:text-red-400">
                  Delete
                </button>
              </div>
            </div>
            <AssignmentEditor
              unitId={selected.id}
              people={people}
              assignments={selectedAssignments}
              peopleById={peopleById}
              onChanged={() => router.refresh()}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
            Select a unit, or create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}

function AssignmentEditor({
  unitId,
  people,
  assignments,
  peopleById,
  onChanged,
}: {
  unitId: string;
  people: Person[];
  assignments: Assignment[];
  peopleById: Record<string, Person>;
  onChanged: () => void;
}) {
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState("");
  const [allocation, setAllocation] = useState("100");
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await createAssignment({
        orgUnitId: unitId,
        personId: isOpen ? null : personId,
        roleOnTeam: role,
        allocationPct: allocation,
        isOpenRole: isOpen,
      });
      if (!res.ok) return setError(res.error);
      setPersonId("");
      setRole("");
      setAllocation("100");
      setIsOpen(false);
      onChanged();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteAssignment(id);
      onChanged();
    });
  }

  return (
    <div className="p-4">
      <h3 className="mb-2 text-sm font-medium text-slate-300">Members</h3>
      <ul className="mb-4 divide-y divide-slate-800 rounded-md border border-slate-800">
        {assignments.length === 0 && (
          <li className="px-3 py-3 text-sm text-slate-500">No members yet.</li>
        )}
        {assignments.map((a) => (
          <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              {a.isOpenRole ? (
                <span className="text-amber-400">○ Open role</span>
              ) : (
                <span className="font-medium">
                  {a.personId ? peopleById[a.personId]?.name ?? "Unknown" : "—"}
                </span>
              )}
              {a.roleOnTeam && <span className="text-slate-400"> · {a.roleOnTeam}</span>}
              {a.allocationPct !== 100 && (
                <span className="text-slate-500"> · {a.allocationPct}%</span>
              )}
            </span>
            <button
              onClick={() => remove(a.id)}
              className="text-slate-500 hover:text-red-400"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Person</span>
          <select
            className={`${field} w-48`}
            disabled={isOpen}
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            <option value="">— select —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Role</span>
          <input
            className={`${field} w-36`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-400">Alloc %</span>
          <input
            className={`${field} w-20`}
            inputMode="numeric"
            value={allocation}
            onChange={(e) => setAllocation(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={isOpen}
            onChange={(e) => setIsOpen(e.target.checked)}
          />
          Open role
        </label>
        <button
          onClick={add}
          disabled={pending}
          className="mb-0.5 rounded-md bg-fuchsia-500 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
