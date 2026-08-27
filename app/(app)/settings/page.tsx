import {
  getDisciplines,
  getVocabulary,
  getDisciplinePeopleCounts,
} from "@/lib/data/queries";
import { SettingsManager } from "@/components/settings/SettingsManager";

/**
 * Workspace settings (S5). Two tabs for now — Vocabulary and Disciplines —
 * deliberately, per the roadmap's guardrail: a tab may only exist once
 * something already reads it.
 */
export default async function SettingsPage() {
  const [vocabulary, disciplines, counts] = await Promise.all([
    getVocabulary(),
    getDisciplines(),
    getDisciplinePeopleCounts(),
  ]);

  return (
    <div className="min-h-[calc(100vh-57px)] bg-paper text-ink">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-ink-soft">
            How this workspace names and categorises itself. Changes apply to everyone here.
          </p>
        </div>
        <SettingsManager
          vocabulary={vocabulary}
          disciplines={disciplines}
          peopleCounts={counts}
        />
      </div>
    </div>
  );
}
