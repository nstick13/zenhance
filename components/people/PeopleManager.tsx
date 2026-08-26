"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person, Discipline } from "@/lib/db/schema";
import {
  createPerson,
  updatePerson,
  deletePerson,
} from "@/lib/data/actions";

type FormState = {
  name: string;
  title: string;
  costPerMonth: string;
  skills: string;
  startDate: string;
  growthFocus: string;
  lastVacationAt: string;
  disciplineId: string;
  employment: "fte" | "contractor" | "vendor" | "unknown";
  location: string;
  timezone: string;
};

const empty: FormState = {
  name: "",
  title: "",
  costPerMonth: "",
  skills: "",
  startDate: "",
  growthFocus: "",
  lastVacationAt: "",
  disciplineId: "",
  employment: "unknown",
  location: "",
  timezone: "",
};

function toForm(p: Person): FormState {
  return {
    name: p.name,
    title: p.title ?? "",
    costPerMonth: p.costPerMonth ?? "",
    skills: (p.skills ?? []).join(", "),
    startDate: p.startDate ?? "",
    growthFocus: p.growthFocus ?? "",
    lastVacationAt: p.lastVacationAt ?? "",
    disciplineId: p.disciplineId ?? "",
    employment: p.employment,
    location: p.location ?? "",
    timezone: p.timezone ?? "",
  };
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  fte: "Employee",
  contractor: "Contractor",
  vendor: "Vendor",
  unknown: "—",
};

const field =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink-soft";

export function PeopleManager({
  initialPeople,
  disciplines,
}: {
  initialPeople: Person[];
  disciplines: Discipline[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setForm(empty);
    setEditingId(null);
    setCreating(true);
    setError(null);
  }
  function openEdit(p: Person) {
    setForm(toForm(p));
    setEditingId(p.id);
    setCreating(false);
    setError(null);
  }
  function close() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = { ...form };
      const res = editingId
        ? await updatePerson(editingId, payload)
        : await createPerson(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this person? Their assignments are removed too.")) return;
    startTransition(async () => {
      await deletePerson(id);
      router.refresh();
    });
  }

  const showForm = creating || editingId !== null;

  return (
    <div>
      <div className="mb-4">
        <button
          onClick={openCreate}
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-ink-soft"
        >
          + Add person
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-line bg-surface p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Name *</span>
              <input
                className={field}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Title</span>
              <input
                className={field}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Discipline</span>
              <select
                className={field}
                value={form.disciplineId}
                onChange={(e) => setForm({ ...form, disciplineId: e.target.value })}
              >
                <option value="">— none —</option>
                {disciplines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Employment</span>
              <select
                className={field}
                value={form.employment}
                onChange={(e) => setForm({ ...form, employment: e.target.value as FormState["employment"] })}
              >
                {(["fte", "contractor", "vendor", "unknown"] as const).map((k) => (
                  <option key={k} value={k}>
                    {EMPLOYMENT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Location</span>
              <input
                className={field}
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Time zone</span>
              <input
                className={field}
                placeholder="Europe/Berlin"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Cost / month ($)</span>
              <input
                className={field}
                inputMode="decimal"
                value={form.costPerMonth}
                onChange={(e) => setForm({ ...form, costPerMonth: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Skills (comma separated)</span>
              <input
                className={field}
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Start date (YYYY-MM-DD)</span>
              <input
                className={field}
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink-soft">Last vacation (YYYY-MM-DD)</span>
              <input
                className={field}
                value={form.lastVacationAt}
                onChange={(e) => setForm({ ...form, lastVacationAt: e.target.value })}
              />
            </label>
            <label className="col-span-2 text-sm">
              <span className="mb-1 block text-ink-soft">Growth focus</span>
              <input
                className={field}
                value={form.growthFocus}
                onChange={(e) => setForm({ ...form, growthFocus: e.target.value })}
              />
            </label>
          </div>
          {error && <p className="mt-3 text-sm text-alert">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {pending ? "Saving…" : editingId ? "Save changes" : "Create person"}
            </button>
            <button
              onClick={close}
              className="rounded-md border border-line px-3 py-2 text-sm hover:bg-paper"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-ink-soft">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Discipline</th>
              <th className="px-4 py-2 font-medium">Employment</th>
              <th className="px-4 py-2 font-medium">Cost/mo</th>
              <th className="px-4 py-2 font-medium">Skills</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {initialPeople.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-ink-soft">No people yet.</p>
                  <p className="mt-2 text-sm text-ink-soft">
                    Add your first person above, or{" "}
                    <a href="/import" className="text-grow hover:underline">
                      import a spreadsheet
                    </a>
                    .
                  </p>
                </td>
              </tr>
            )}
            {initialPeople.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-ink">{p.title ?? "—"}</td>
                <td className="px-4 py-2 text-ink">
                  {disciplines.find((d) => d.id === p.disciplineId)?.name ?? "—"}
                </td>
                <td className="px-4 py-2 text-ink-soft">{EMPLOYMENT_LABELS[p.employment] ?? "—"}</td>
                <td className="px-4 py-2 text-ink">
                  {p.costPerMonth ? `$${Number(p.costPerMonth).toLocaleString()}` : "—"}
                </td>
                <td className="px-4 py-2 text-ink-soft">
                  {(p.skills ?? []).slice(0, 4).join(", ") || "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => openEdit(p)}
                    className="mr-3 text-ink-soft hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="text-ink-soft hover:text-alert"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
