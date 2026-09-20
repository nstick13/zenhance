/**
 * The two demo companies, as plain data with **no database imports** — this
 * module is pulled into the client bundle by the import page's cards, so it
 * must stay free of `postgres`/drizzle. The seeding itself lives in
 * `lib/db/companies.ts`, which imports this.
 *
 * `name` is what the workspace and its root unit are called; change it here
 * and both follow.
 *
 * NOTE: these names are personal to the current demo account. Before there
 * are real customers on the seeding button, swap them for neutral ones.
 */
export const DEMO_COMPANIES = {
  small: {
    name: "Nate's Small Organization",
    label: "Small organization",
    blurb: "10 people, two lines and an oversight group — everything on screen at once.",
  },
  large: {
    name: "Nate's Big Organization",
    label: "Large organization",
    blurb: "~2,400 people over 12 rungs — a real enterprise shape, ragged depth and all.",
  },
} as const;

export type DemoCompanyKind = keyof typeof DEMO_COMPANIES;

/** The scale fixture is retained for benchmarks and historical design work,
 * but is no longer part of the interactive local demo while we settle the
 * small-company visual language. Include the earlier seeded name so existing
 * workspaces disappear from the switcher without deleting their data. */
export function isRetiredScaleDemoWorkspace(name: string): boolean {
  return name === DEMO_COMPANIES.large.name || name === "Northwind Freight & Logistics";
}
