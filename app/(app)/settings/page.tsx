import {
  getDisciplines,
  getVocabulary,
  getDisciplinePeopleCounts,
  getWorkspaceLens,
  getFindingsPolicy,
} from "@/lib/data/queries";
import { SettingsManager } from "@/components/settings/SettingsManager";
import type { FindingsConfigView } from "@/components/settings/SettingsManager";

/**
 * Workspace settings (S5). Every tab here edits the *workspace default* — what
 * a colleague inherits on their first open — never one person's current view.
 * The guardrail holds: a tab may only exist once something already reads it.
 */
export default async function SettingsPage() {
  const [vocabulary, disciplines, counts, lens, policy] = await Promise.all([
    getVocabulary(),
    getDisciplines(),
    getDisciplinePeopleCounts(),
    getWorkspaceLens(),
    getFindingsPolicy(),
  ]);

  // The Map in FindingsPolicy doesn't cross the server→client boundary cleanly;
  // hand the tab a plain record (key present with null = "no limit", key absent
  // = inherit the default).
  const findings: FindingsConfigView = {
    spreadEnabled: policy.spreadEnabled,
    overCommitmentEnabled: policy.overCommitmentEnabled,
    couplingEnabled: policy.couplingEnabled,
    defaultSpreadThreshold: policy.defaultSpreadThreshold,
    overrides: Object.fromEntries(policy.perDiscipline),
  };

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
          lens={lens}
          findings={findings}
        />
      </div>
    </div>
  );
}
