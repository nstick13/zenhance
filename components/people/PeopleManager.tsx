"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@/lib/db/schema";
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
};

const empty: FormState = {
  name: "",
  title: "",
  costPerMonth: "",
  skills: "",
  startDate: "",
  growthFocus: "",
  lastVacationAt: "",
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
  };
}

const field =
  "w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-fuchsia-500";

export function PeopleManager({ initialPeople }: { initialPeople: Person[] }) {
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
          className="rounded-md bg-fuchsia-500 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-400"
        >
          + Add person
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Name *</span>
              <input
                className={field}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Title</span>
              <input
                className={field}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Cost / month ($)</span>
              <input
                className={field}
                inputMode="decimal"
                value={form.costPerMonth}
                onChange={(e) => setForm({ ...form, costPerMonth: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Skills (comma separated)</span>
              <input
                className={field}
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Start date (YYYY-MM-DD)</span>
              <input
                className={field}
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Last vacation (YYYY-MM-DD)</span>
              <input
                className={field}
                value={form.lastVacationAt}
                onChange={(e) => setForm({ ...form, lastVacationAt: e.target.value })}
              />
            </label>
            <label className="col-span-2 text-sm">
              <span className="mb-1 block text-slate-400">Growth focus</span>
              <input
                className={field}
                value={form.growthFocus}
                onChange={(e) => setForm({ ...form, growthFocus: e.target.value })}
              />
            </label>
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-fuchsia-500 px-3 py-2 text-sm font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50"
            >
              {pending ? "Saving…" : editingId ? "Save changes" : "Create person"}
            </button>
            <button
              onClick={close}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-left text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Cost/mo</th>
              <th className="px-4 py-2 font-medium">Skills</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {initialPeople.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <p className="text-slate-500">No people yet.</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Add your first person above, or{" "}
                    <a href="/import" className="text-fuchsia-400 hover:underline">
                      import a spreadsheet
                    </a>
                    .
                  </p>
                </td>
              </tr>
            )}
            {initialPeople.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-slate-300">{p.title ?? "—"}</td>
                <td className="px-4 py-2 text-slate-300">
                  {p.costPerMonth ? `$${Number(p.costPerMonth).toLocaleString()}` : "—"}
                </td>
                <td className="px-4 py-2 text-slate-400">
                  {(p.skills ?? []).slice(0, 4).join(", ") || "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => openEdit(p)}
                    className="mr-3 text-slate-400 hover:text-slate-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="text-slate-500 hover:text-red-400"
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
