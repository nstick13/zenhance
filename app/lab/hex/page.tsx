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
  searchParams: Promise<{ company?: string; density?: string }>;
}) {
  const params = await searchParams;
  const key: Key = (params.company as Key) in COMPANIES ? (params.company as Key) : "medium";
  const spec = COMPANIES[key];
  const org = buildDeepOrg("hexlab", {
    people: spec.people, maxDepth: spec.maxDepth, seed: 7, spotlight: spec.spotlight,
  });

  // Only the fields `buildOrbitalTree` reads — the rest of a seeded company is
  // weight this page would carry for nothing.
  const payload: LabOrg = {
    units: org.units.map((u) => ({
      id: u.id,
      name: u.name,
      parentId: u.parentId ?? null,

      leadPersonId: u.leadPersonId ?? null,
    })),
    people: org.people.map((p) => ({ id: p.id, name: p.name })),
    assignments: org.assignments.map((a) => ({
      personId: a.personId,
      orgUnitId: a.orgUnitId,
      allocationPct: a.allocationPct ?? 100,
    })),
  };

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
            href={`/lab/hex?company=${k}${params.density ? `&density=${params.density}` : ""}`}
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
      </nav>
      <HexLab org={payload} companyKey={key} initialDensity={params.density === "tight" ? "tight" : "roomy"} />
    </main>
  );
}
