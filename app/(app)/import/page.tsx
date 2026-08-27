import { ImportWizard } from "@/components/import/ImportWizard";
import { getDisciplines } from "@/lib/data/queries";

export default async function ImportPage() {
  // The workspace's curated taxonomy, so a title→discipline suggestion reuses
  // the names it already has instead of inventing near-duplicates beside them.
  const disciplines = await getDisciplines();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Import from a spreadsheet</h1>
        <p className="text-sm text-ink-soft">
          Upload an Excel or CSV file. We&apos;ll detect your columns — adjust the
          mapping if needed, then import. References between sheets resolve by name.
        </p>
      </div>
      <ImportWizard knownDisciplines={disciplines.map((d) => d.name)} />
    </div>
  );
}
