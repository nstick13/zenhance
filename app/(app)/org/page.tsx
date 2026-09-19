import { getOrgSnapshot, getMapNodes, getOrbitalNodes, getFindingsPolicy } from "@/lib/data/queries";
import { RadialOrg } from "@/components/viz/RadialOrg";
import { OrgCanvasLoader } from "@/components/viz/OrgCanvasLoader";
import { OrbitalMapLoader } from "@/components/viz/orbital/OrbitalMapLoader";
import { OrgViewSwitcher } from "@/components/viz/OrgViewSwitcher";
import { StartCompany } from "@/components/onboarding/StartCompany";
import { GetStartedGuide } from "@/components/onboarding/GetStartedGuide";

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { view } = await searchParams;
  const { people, units, assignments, disciplines, lens, vocabulary } =
    await getOrgSnapshot();
  const isEmpty = units.length === 0;

  // Nothing here yet: drop straight onto the map and name the company there,
  // rather than presenting a menu of things to go and do first.
  if (isEmpty) return <StartCompany vocabulary={vocabulary} />;

  // Every view shares one shell so the switcher is always in the same place.
  const shell = (id: string, map: React.ReactNode) => (
    <div className="relative h-[calc(100vh-57px)]">
      {map}
      <OrgViewSwitcher active={id} />
      <GetStartedGuide
        units={units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, parentId: u.parentId }))}
        peopleCount={people.length}
        vocabulary={vocabulary}
      />
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
