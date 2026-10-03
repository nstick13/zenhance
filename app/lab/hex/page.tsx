/**
 * `/lab/hex` — the hexagonal grid study (Greg, 2026-09-29).
 *
 * A feel study, not a product surface. It answers two questions and no
 * others: does a company on a uniform hex lattice read better than the same
 * company on orbits, and how often does a child fail to get a cell next to
 * its parent?
 *
 * Server half. It exists only because the fixture generator uses Node's
 * `randomUUID`, so the company has to be invented here and handed across as
 * plain arrays. One company per request, chosen by `?company=`, so picking
 * Northwind does not cost every other page load 400 KB of invented people.
 */
import Link from "next/link";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import HexLab, { type LabOrg } from "./HexLab";

export const metadata = { title: "Hex grid study", robots: { index: false, follow: false } };

/**
 * `spotlight` forces the first and last team to a given size, so both ends of
 * Greg's question are always on the map: *"a team with a few members, and a
 * team with the maximum number of members you can realistically squeeze into a
 * host cell — say 50."* Sparrow-ish is left alone; a fifty-person team inside a
 * ten-person company is not a case anyone needs to look at.
 */
const SPOTLIGHT = { small: 3, large: 50 };

const COMPANIES = {
  small: { label: "Sparrow-ish · 10", people: 10, maxDepth: 2, spotlight: undefined },
  medium: { label: "Digital Tailoring-ish · 45", people: 45, maxDepth: 4, spotlight: SPOTLIGHT },
  large: { label: "1,000 · 8 rungs", people: 1000, maxDepth: 8, spotlight: SPOTLIGHT },
  northwind: { label: "Northwind · 2,562 · 11 rungs", people: 2400, maxDepth: 11, spotlight: SPOTLIGHT },
} as const;

type Key = keyof typeof COMPANIES;

export default async function HexLabPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; density?: string; strata?: string }>;
}) {
  const params = await searchParams;
  const key: Key = (params.company as Key) in COMPANIES ? (params.company as Key) : "medium";
  const spec = COMPANIES[key];
  /**
   * `?strata=people` moves the whole model up a level — Greg, 2026-10-03:
   * *"team nodes are the smallest absolute unit. In the next iteration, we
   * should test human nodes being the smallest absolute unit, since this is
   * what companies are made of."*
   *
   * Every person becomes a unit, reporting to their actual manager rather than
   * to the team; the team keeps a cell of its own. The engine is handed the
   * same shape it always gets — a tree of units — so nothing in `lib/map`
   * knows this experiment is happening.
   */
  const strata = params.strata === "people" ? "people" : "teams";
  const org = buildDeepOrg("hexlab", {
    people: spec.people, maxDepth: spec.maxDepth, seed: 7, spotlight: spec.spotlight,
    // A flat team is a lie, and it is the lie that decides whether this works:
    // fifty people reporting to one node is a fifty-wide span no lattice can
    // seat. Given a real tree it is spans of two to five.
    inTeamSpan: strata === "people" ? [2, 5] : undefined,
  });

  /** Person id → the team they sit in, for the layout's cohesion grouping. */
  const teamOf = new Map<string, string>();
  for (const a of org.assignments) {
    if (a.personId && !teamOf.has(a.personId)) teamOf.set(a.personId, a.orgUnitId);
  }
  /**
   * A team's lead hangs off the **team**, not off their own manager.
   *
   * The fixture gives a lead a `managerId` pointing at the lead of the unit
   * above — true to life, and wrong here: following it made every lead chain
   * to the lead above them, so the whole company's people formed one tree
   * hanging off the CEO and every team cell was a childless orphan sitting
   * among the units. That is what stranded team nodes 17 to 19 cells from
   * their own people. The reporting line a lead has upward is drawn by the
   * team's own chain to its parent unit; the person belongs to the team.
   */
  const leadOf = new Map(org.units.filter((u) => u.leadPersonId).map((u) => [u.leadPersonId!, u.id]));
  const peopleById = new Map(org.people.map((p) => [p.id, p]));
  const personUnits = strata === "people"
    ? [...teamOf].map(([personId, unitId]) => {
        const manager = peopleById.get(personId)?.managerId ?? null;
        const leads = leadOf.get(personId);
        return {
          id: `person:${personId}`,
          name: peopleById.get(personId)?.name ?? personId,
          parentId: leads ? leads : manager ? `person:${manager}` : unitId,
          leadPersonId: null,
          team: unitId,
          /** Drawn differently: this person leads the unit they hang from. */
          isLead: Boolean(leads),
        };
      })
    : [];

  // Only the fields `buildOrbitalTree` reads — the rest of a seeded company is
  // weight this page would carry for nothing.
  const payload: LabOrg = {
    units: [
      ...org.units.map((u) => ({
        id: u.id,
        name: u.name,
        parentId: u.parentId ?? null,
        leadPersonId: u.leadPersonId ?? null,
      })),
      ...personUnits.map(({ team, isLead, ...u }) => { void team; void isLead; return u; }),
    ],
    // With people promoted to units they are no longer seats, so the unit tree
    // is the whole picture and nothing orbits anything.
    people: strata === "people" ? [] : org.people.map((p) => ({ id: p.id, name: p.name })),
    assignments: strata === "people" ? [] : org.assignments.map((a) => ({
      personId: a.personId,
      orgUnitId: a.orgUnitId,
      allocationPct: a.allocationPct ?? 100,
    })),
  };
  /** unit id → the team it belongs to, so the allocator can keep a team whole. */
  const groups: [string, string][] = personUnits.map((u) => [u.id, u.team]);
  /** The people who lead the unit they report to, so the renderer can mark the
   *  leadership chain and tell a person from a structural node. */
  const leads: string[] = personUnits.filter((u) => u.isLead).map((u) => u.id);

  /**
   * Each team's line of ancestry, so the layout can tell a sibling from a
   * cousin from a stranger and space them accordingly. Shipped as data rather
   * than as a function, because this crosses the server/client boundary.
   */
  const ancestry: [string, string[]][] = org.units.map((u) => {
    const line: string[] = [];
    let at: string | null = u.parentId ?? null;
    const byId = new Map(org.units.map((x) => [x.id, x]));
    while (at) { line.push(at); at = byId.get(at)?.parentId ?? null; }
    return [u.id, line];
  });

  return (
    <main style={{ position: "fixed", inset: 0, background: "#fbfbfd", overflow: "hidden" }}>
      <nav
        style={{
          position: "absolute", zIndex: 5, top: 12, left: 12, display: "flex", gap: 6,
          flexWrap: "wrap", alignItems: "center", fontFamily: "ui-sans-serif, system-ui",
          fontSize: 12,
        }}
      >
        <span style={{ color: "#6b7280", marginRight: 4 }}>company</span>
        {(Object.keys(COMPANIES) as Key[]).map((k) => (
          <Link
            key={k}
            href={`/lab/hex?company=${k}${params.density ? `&density=${params.density}` : ""}${strata === "people" ? "&strata=people" : ""}`}
            style={{
              padding: "4px 9px", borderRadius: 999, textDecoration: "none",
              border: `1px solid ${k === key ? "#4f46e5" : "#e5e7eb"}`,
              background: k === key ? "#4f46e5" : "#fff",
              color: k === key ? "#fff" : "#374151",
            }}
          >
            {COMPANIES[k].label}
          </Link>
        ))}
        <span style={{ color: "#6b7280", margin: "0 4px 0 10px" }}>smallest unit</span>
        {(["teams", "people"] as const).map((t) => (
          <Link
            key={t}
            href={`/lab/hex?company=${key}${params.density ? `&density=${params.density}` : ""}${t === "people" ? "&strata=people" : ""}`}
            style={{
              padding: "4px 9px", borderRadius: 999, textDecoration: "none",
              border: `1px solid ${t === strata ? "#0f766e" : "#e5e7eb"}`,
              background: t === strata ? "#0f766e" : "#fff",
              color: t === strata ? "#fff" : "#374151",
            }}
          >
            {t}
          </Link>
        ))}
      </nav>
      <HexLab
        org={payload}
        companyKey={strata === "people" ? `${key}-people` : key}
        initialDensity={params.density === "tight" ? "tight" : "roomy"}
        groups={groups}
        leads={leads}
        ancestry={ancestry}
      />
    </main>
  );
}
