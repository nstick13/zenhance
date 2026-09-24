import Link from "next/link";
import { getOrgSnapshot, getOrbitalNodes } from "@/lib/data/queries";
import { OrbitalMapLoader } from "@/components/viz/orbital/OrbitalMapLoader";
import { loadDemoOrg } from "@/lib/data/actions";
import { OnboardingBanner } from "@/components/OnboardingBanner";

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { view, geography } = await searchParams;
  const { people, units, assignments, disciplines, lens, vocabulary, sampleWork } =
    await getOrgSnapshot();
  const isEmpty = units.length === 0;

  if (isEmpty) {
    return (
      <div className="relative flex h-[calc(100vh-57px)] items-center justify-center bg-paper p-6 text-ink">
        <OnboardingBanner />
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 h-16 w-16 rounded-full border-4 border-grow bg-surface" />
          <h1 className="text-2xl font-semibold">Your delivery org, visualized</h1>
          <p className="mt-2 text-ink-soft">
            Build your organization from scratch or import it from a spreadsheet.
            Then see it as a living map and surface what the structure hides.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <form action={loadDemoOrg}>
              <button
                type="submit"
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft"
              >
                Load demo org
              </button>
            </form>
            <Link
              href="/teams"
              className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-paper"
            >
              Build from scratch
            </Link>
            <Link
              href="/import"
              className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-paper"
            >
              Import a spreadsheet
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const savedNodes = await getOrbitalNodes();
  return (
    <div className="relative h-[calc(100vh-57px)]">
      <OrbitalMapLoader
        people={people}
        units={units}
        assignments={assignments}
        vocabulary={vocabulary}
        savedNodes={savedNodes}
        sampleWork={sampleWork}
        // Dev-only look at large-company geography on the small invented demo
        // companies — never available on a real workspace (sampleWork is false).
        previewGeography={sampleWork && geography === "local" ? "local" : undefined}
      />
    </div>
  );
}
