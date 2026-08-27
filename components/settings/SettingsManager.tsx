"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Discipline } from "@/lib/db/schema";
import {
  createDiscipline,
  updateDiscipline,
  deleteDiscipline,
  mergeDisciplines,
  reorderDisciplines,
  saveVocabulary,
} from "@/lib/data/actions";
import {
  DISCIPLINE_RAMP,
  NO_VALUE_COLOR,
} from "@/lib/canvas/lens";
import {
  DEFAULT_VOCABULARY,
  PRESETS,
  matchPreset,
  isDefaultVocabulary,
  lower,
  type Vocabulary,
} from "@/lib/vocabulary";

const field =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink-soft";

type TabId = "vocabulary" | "disciplines";

const TABS: { id: TabId; label: string; blurb: string }[] = [
  {
    id: "vocabulary",
    label: "Vocabulary",
    blurb: "What you call the two rungs of the map.",
  },
  {
    id: "disciplines",
    label: "Disciplines",
    blurb: "What a person is — the taxonomy colour-by-discipline reads.",
  },
];

export function SettingsManager({
  vocabulary,
  disciplines,
  peopleCounts,
}: {
  vocabulary: Vocabulary;
  disciplines: Discipline[];
  peopleCounts: Record<string, number>;
}) {
  const [tab, setTab] = useState<TabId>("vocabulary");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div>
      <div className="mb-4 flex items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              t.id === tab
                ? "border-ink font-medium text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-ink-soft">{active.blurb}</p>

      {tab === "vocabulary" ? (
        <VocabularyTab vocabulary={vocabulary} />
      ) : (
        <DisciplinesTab disciplines={disciplines} peopleCounts={peopleCounts} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ tab 1 */

/**
 * Vocabulary. Two rungs, four strings. The presets exist because Heather asked
 * for examples with metadata — an org that says "vertical product group"
 * shouldn't have to work out that it means value stream.
 */
function VocabularyTab({ vocabulary }: { vocabulary: Vocabulary }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Vocabulary>(vocabulary);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const matched = useMemo(() => matchPreset(draft), [draft]);

  function set(rung: "stream" | "team", key: "singular" | "plural", value: string) {
    setSaved(false);
    setDraft({ ...draft, [rung]: { ...draft[rung], [key]: value } });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveVocabulary(draft);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-1 font-medium">Start from an example</h3>
        <p className="mb-3 text-xs text-ink-soft">
          Same structure either way — these only change what the app calls things.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const on = matched?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSaved(false);
                  setDraft(p.vocabulary);
                }}
                className={`rounded-md border p-3 text-left transition-colors ${
                  on ? "border-ink bg-paper" : "border-line hover:bg-paper"
                }`}
              >
                <div className="text-sm font-medium text-ink">{p.label}</div>
                <div className="mt-1 text-xs text-ink-soft">
                  {p.vocabulary.stream.singular} · {p.vocabulary.team.singular}
                </div>
                <p className="mt-2 text-xs leading-snug text-ink-soft">{p.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-line">
        <div className="border-b border-line px-4 py-3">
          <h3 className="font-medium">Your terms</h3>
          <p className="text-xs text-ink-soft">
            {matched ? `Matches the ${matched.label} preset.` : "Custom."}
          </p>
        </div>
        <div className="space-y-4 p-4">
          <RungFields
            heading="Top rung"
            hint="A group of teams that delivers something end to end."
            term={draft.stream}
            onChange={(k, v) => set("stream", k, v)}
          />
          <RungFields
            heading="Bottom rung"
            hint="The unit people are actually assigned to."
            term={draft.team}
            onChange={(k, v) => set("team", k, v)}
          />

          <div className="rounded-md bg-paper p-3 text-xs text-ink-soft">
            Preview: “Add a {lower(draft.team.singular)} to this{" "}
            {lower(draft.stream.singular)}” · “{draft.stream.plural}” ·{" "}
            “{draft.team.plural}”
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save vocabulary"}
            </button>
            {!isDefaultVocabulary(draft) && (
              <button
                onClick={() => {
                  setSaved(false);
                  setDraft(DEFAULT_VOCABULARY);
                }}
                className="rounded-md border border-line px-3 py-2 text-sm hover:bg-paper"
              >
                Reset to default
              </button>
            )}
            {saved && !pending && <span className="text-sm text-grow">Saved.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RungFields({
  heading,
  hint,
  term,
  onChange,
}: {
  heading: string;
  hint: string;
  term: { singular: string; plural: string };
  onChange: (key: "singular" | "plural", value: string) => void;
}) {
  return (
    <div>
      <div className="mb-2">
        <span className="text-sm font-medium text-ink">{heading}</span>
        <span className="ml-2 text-xs text-ink-soft">{hint}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-ink-soft">Singular</span>
          <input
            className={field}
            maxLength={40}
            value={term.singular}
            onChange={(e) => onChange("singular", e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-soft">Plural</span>
          <input
            className={field}
            maxLength={40}
            value={term.plural}
            onChange={(e) => onChange("plural", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tab 2 */

type Draft = { name: string; color: string | null };

/**
 * Disciplines. This is the CRUD the schema has been waiting for: the table has
 * had `color` and `sort_order` since it was created and nothing could set
 * either, so colour-by-discipline always fell through to the ramp.
 */
function DisciplinesTab({
  disciplines,
  peopleCounts,
}: {
  disciplines: Discipline[];
  peopleCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", color: null });
  const [newName, setNewName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [mergeFromId, setMergeFromId] = useState<string | null>(null);
  const [mergeIntoId, setMergeIntoId] = useState("");

  // The list is already sorted by sortOrder server-side; keep that order local
  // so the arrows read as "move up/down" rather than "resort by name".
  const list = disciplines;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong");
      setEditingId(null);
      setDeletingId(null);
      setMergeFromId(null);
      router.refresh();
    });
  };

  function add() {
    const name = newName.trim();
    if (!name) return;
    // Give a new row the next ramp colour rather than null, so a fresh
    // workspace gets a legible legend without a trip to the colour picker.
    const color = DISCIPLINE_RAMP[list.length % DISCIPLINE_RAMP.length];
    run(async () => {
      const res = await createDiscipline({ name, color, sortOrder: 0 });
      if (res.ok) setNewName("");
      return res;
    });
  }

  function saveEdit(d: Discipline) {
    run(() =>
      updateDiscipline(d.id, {
        name: draft.name,
        color: draft.color ?? "",
        sortOrder: d.sortOrder,
      }),
    );
  }

  function move(index: number, delta: number) {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() => reorderDisciplines(next.map((d) => d.id)));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-medium text-ink">
            {list.length} discipline{list.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <input
              className="w-48 rounded-md border border-line bg-paper px-2 py-1 text-sm outline-none focus:border-ink-soft"
              placeholder="New discipline…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button
              onClick={add}
              disabled={pending || !newName.trim()}
              className="rounded bg-ink px-2 py-1 text-xs font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              + Add
            </button>
          </div>
        </div>

        {list.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">
            No disciplines yet. Add one above — or import people with a discipline
            column and they will appear here.
          </p>
        )}

        <ul className="divide-y divide-line">
          {list.map((d, i) => {
            const count = peopleCounts[d.id] ?? 0;
            const swatch = d.color ?? DISCIPLINE_RAMP[i % DISCIPLINE_RAMP.length];
            const isEditing = editingId === d.id;

            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || pending}
                      className="text-xs leading-none text-ink-soft hover:text-ink disabled:opacity-25"
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === list.length - 1 || pending}
                      className="text-xs leading-none text-ink-soft hover:text-ink disabled:opacity-25"
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </div>

                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-line"
                    style={{ background: swatch }}
                  />

                  {isEditing ? (
                    <>
                      <input
                        className={field}
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                      <input
                        type="color"
                        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-paper"
                        value={draft.color ?? swatch}
                        onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                      />
                      <button
                        onClick={() => setDraft({ ...draft, color: null })}
                        className="shrink-0 rounded border border-line px-2 py-1 text-xs hover:bg-paper"
                        title="Fall back to the automatic ramp colour"
                      >
                        Auto
                      </button>
                      <button
                        onClick={() => saveEdit(d)}
                        disabled={pending}
                        className="shrink-0 rounded bg-ink px-2 py-1 text-xs font-medium text-white hover:bg-ink-soft disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="shrink-0 rounded border border-line px-2 py-1 text-xs hover:bg-paper"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-ink">{d.name}</span>
                      <span className="text-xs text-ink-soft">
                        {count} {count === 1 ? "person" : "people"}
                      </span>
                      {!d.color && (
                        <span
                          className="rounded bg-paper px-1 text-[10px] text-ink-soft"
                          title="No colour set — the map picks one from the ramp"
                        >
                          auto
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(d.id);
                          setDraft({ name: d.name, color: d.color });
                        }}
                        className="rounded border border-line px-2 py-1 text-xs hover:bg-paper"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setMergeFromId(d.id);
                          setMergeIntoId("");
                        }}
                        disabled={list.length < 2}
                        className="rounded border border-line px-2 py-1 text-xs hover:bg-paper disabled:opacity-40"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => {
                          setDeletingId(d.id);
                          setReassignTo("");
                        }}
                        className="rounded border border-line px-2 py-1 text-xs text-alert hover:bg-paper"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>

                {deletingId === d.id && (
                  <div className="mt-3 rounded-md border border-line bg-paper p-3">
                    <p className="text-sm text-ink">
                      Delete “{d.name}”?{" "}
                      {count > 0 ? (
                        <>
                          <strong>
                            {count} {count === 1 ? "person" : "people"}
                          </strong>{" "}
                          currently hold it.
                        </>
                      ) : (
                        "Nobody holds it."
                      )}
                    </p>
                    {count > 0 && (
                      <label className="mt-2 block text-sm">
                        <span className="mb-1 block text-ink-soft">Reassign them to</span>
                        <select
                          className={field}
                          value={reassignTo}
                          onChange={(e) => setReassignTo(e.target.value)}
                        >
                          <option value="">— no discipline —</option>
                          {list
                            .filter((o) => o.id !== d.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => run(() => deleteDiscipline(d.id, reassignTo || null))}
                        disabled={pending}
                        className="rounded-md bg-alert px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {pending ? "Deleting…" : "Delete"}
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {mergeFromId === d.id && (
                  <div className="mt-3 rounded-md border border-line bg-paper p-3">
                    <p className="text-sm text-ink">
                      Fold “{d.name}” into another discipline. Everyone holding it moves
                      across and “{d.name}” goes away.
                    </p>
                    <label className="mt-2 block text-sm">
                      <span className="mb-1 block text-ink-soft">Merge into</span>
                      <select
                        className={field}
                        value={mergeIntoId}
                        onChange={(e) => setMergeIntoId(e.target.value)}
                      >
                        <option value="">— choose —</option>
                        {list
                          .filter((o) => o.id !== d.id)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => run(() => mergeDisciplines(d.id, mergeIntoId))}
                        disabled={pending || !mergeIntoId}
                        className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
                      >
                        {pending ? "Merging…" : "Merge"}
                      </button>
                      <button
                        onClick={() => setMergeFromId(null)}
                        className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="text-sm text-alert">{error}</p>}

      <p className="text-xs text-ink-soft">
        Colours here drive <strong>colour by discipline</strong> on the map. A row left
        on “auto” borrows the next colour from the built-in ramp; someone with no
        discipline at all stays{" "}
        <span
          className="inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: NO_VALUE_COLOR }}
        />{" "}
        grey, so a gap reads as a gap.
      </p>
    </div>
  );
}
