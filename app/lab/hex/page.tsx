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
import { buildLabCompany, COMPANIES, type CompanyKey } from "./company";
import HexLab from "./HexLab";

export const metadata = { title: "Hex grid study", robots: { index: false, follow: false } };


export default async function HexLabPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; density?: string; strata?: string }>;
}) {
  const params = await searchParams;
  const key: CompanyKey = (params.company as CompanyKey) in COMPANIES
    ? (params.company as CompanyKey)
    : "medium";
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
  const { org: payload, groups, leads } = buildLabCompany(key, strata);

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
        {(Object.keys(COMPANIES) as CompanyKey[]).map((k) => (
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
      />
    </main>
  );
}
