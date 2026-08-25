import Link from "next/link";
import { getOrgSnapshot, getMapNodes } from "@/lib/data/queries";
import { RadialOrg } from "@/components/viz/RadialOrg";
import { OrgCanvasLoader } from "@/components/viz/OrgCanvasLoader";
import { loadDemoOrg } from "@/lib/data/actions";
import { OnboardingBanner } from "@/components/OnboardingBanner";

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { view } = await searchParams;
  const { people, units, assignments } = await getOrgSnapshot();
  const isEmpty = units.length === 0;

  if (isEmpty) {
    return (
      <div className="relative flex h-[calc(100vh-57px)] items-center justify-center p-6">
        <OnboardingBanner />
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 h-16 w-16 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 opacity-80" />
          <h1 className="text-2xl font-semibold">Your delivery org, visualized</h1>
          <p className="mt-2 text-slate-400">
            Build your organization from scratch or import it from a spreadsheet.
            Then see it as a living map and surface what the structure hides.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <form action={loadDemoOrg}>
              <button
                type="submit"
                className="rounded-md bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-400"
              >
                Load demo org
              </button>
            </form>
            <Link
              href="/teams"
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800"
            >
              Build from scratch
            </Link>
            <Link
              href="/import"
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800"
            >
              Import a spreadsheet
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (view === "canvas") {
    const mapNodeRows = await getMapNodes();
    return (
      <div className="h-[calc(100vh-57px)]">
        <OrgCanvasLoader
          people={people}
          units={units}
          assignments={assignments}
          mapNodeRows={mapNodeRows}
        />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-57px)]">
      <RadialOrg people={people} units={units} assignments={assignments} />
    </div>
  );
}
