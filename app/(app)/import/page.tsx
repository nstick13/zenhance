import { ImportWizard } from "@/components/import/ImportWizard";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Import from a spreadsheet</h1>
        <p className="text-sm text-slate-400">
          Upload an Excel or CSV file. We&apos;ll detect your columns — adjust the
          mapping if needed, then import. References between sheets resolve by name.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
