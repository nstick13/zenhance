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
 *
 * **The company switcher moved into `HexLab` on 2026-11-09.** It was a `<nav>`
 * rendered right here, and it is now rendered by the lab itself from the
 * `companies` list below. Greg asked for the study's readouts to collapse into
 * *"a dropdown next to the different company options, to the top left, before
 * where it says 'company'"* — one strip, one row, the dropdown first. Two
 * components cannot share a row across the server/client line without one of
 * them guessing the other's width, so the row belongs to whichever of the two
 * is a client component, and the dropdown has to be.
 *
 * What stays here is the half that cannot move: `buildLabCompany` reaches the
 * fixture generator, which uses Node's `randomUUID`. Only the labels cross.
 */
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
        /**
         * **Labels only.** The lab draws the switcher; it must not be able to
         * reach `./company`, because importing that module client-side would
         * pull the whole fixture generator into the browser bundle to read
         * five strings out of it.
         */
        companies={(Object.keys(COMPANIES) as CompanyKey[]).map((k) => ({
          key: k,
          label: COMPANIES[k].label,
          current: k === key,
        }))}
      />
    </main>
  );
}
