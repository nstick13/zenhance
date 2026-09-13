import Link from "next/link";
import { getOrgSnapshot, getMapNodes, getOrbitalNodes, getFindingsPolicy } from "@/lib/data/queries";
import { RadialOrg } from "@/components/viz/RadialOrg";
import { OrgCanvasLoader } from "@/components/viz/OrgCanvasLoader";
import { OrbitalMapLoader } from "@/components/viz/orbital/OrbitalMapLoader";
import { OrgViewSwitcher } from "@/components/viz/OrgViewSwitcher";
import { loadDemoOrg } from "@/lib/data/actions";
import { OnboardingBanner } from "@/components/OnboardingBanner";

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { view } = await searchParams;
  const { people, units, assignments, disciplines, lens, vocabulary } =
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

  // Every view shares one shell so the switcher is always in the same place.
  const shell = (id: string, map: React.ReactNode) => (
    <div className="relative h-[calc(100vh-57px)]">
      {map}
      <OrgViewSwitcher active={id} />
    </div>
  );

  // The v2 canvas, now the alternate lens at ?view=canvas — the orbital map
  // took over as the default on 2026-09-13 (Greg: "this needs to replace the
  // current view as the default visualisation and behaviour").
  if (view === "canvas") {
    const mapNodeRows = await getMapNodes();
    return shell(
      "canvas",
      <OrgCanvasLoader
        people={people}
        units={units}
        assignments={assignments}
        mapNodeRows={mapNodeRows}
        disciplines={disciplines}
        lens={lens}
        vocabulary={vocabulary}
      />,
    );
  }

  if (view === "radial") {
    const findingsPolicy = await getFindingsPolicy();
    return shell(
      "radial",
      <RadialOrg
        people={people}
        units={units}
        assignments={assignments}
        findingsPolicy={findingsPolicy}
      />,
    );
  }

  const savedNodes = await getOrbitalNodes();
  return shell(
    "orbital",
    <OrbitalMapLoader
      people={people}
      units={units}
      assignments={assignments}
      vocabulary={vocabulary}
      savedNodes={savedNodes}
    />,
  );
}
