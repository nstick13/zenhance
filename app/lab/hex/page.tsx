/**
 * `/lab/hex` — the hexagonal grid study (Greg, 2026-09-29).
 *
 * A feel study, not a product surface. It answers one question and no others:
 * does a company on a uniform hex lattice read better than the same company on
 * orbits, and how often does a child fail to get a cell next to its parent?
 *
 * Server half. It exists only because the fixture generator uses Node's
 * `randomUUID`, so the company has to be invented here and handed across as
 * plain arrays. One company per request, chosen by `?company=`.
 *
 * **The settings came off on 2026-11-06.** This page used to carry two
 * switches of its own — `?strata=` (teams or people as the smallest unit) and
 * `?density=` (roomy or tight cells) — and the lab panel carried four more.
 * Greg settled all six: a person is always the smallest unit, cells are always
 * roomy, and the three placement choices are fixed in `HexLab.tsx`. What is
 * left here is the company you are looking at, which is the only thing still
 * worth switching.
 */
import Link from "next/link";
import { buildLabCompany, COMPANIES, type CompanyKey } from "./company";
import HexLab from "./HexLab";

export const metadata = { title: "Hex grid study", robots: { index: false, follow: false } };

export default async function HexLabPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const params = await searchParams;
  const key: CompanyKey = (params.company as CompanyKey) in COMPANIES
    ? (params.company as CompanyKey)
    : "medium";
  const { org: payload, groups, leads } = buildLabCompany(key);

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
            href={`/lab/hex?company=${k}`}
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
      <HexLab
        org={payload}
        /**
         * **The `-people` suffix stays, though there is only one strata now.**
         * It is part of the key every saved arrangement is stored under
         * (`storeKey` in `HexLab.tsx`), so dropping it would orphan every
         * arrangement Greg has made. It costs nothing to keep and it is not
         * worth losing his work over tidiness.
         */
        companyKey={`${key}-people`}
        groups={groups}
        leads={leads}
      />
    </main>
  );
}
