/**
 * The demo company, as plain data with **no database imports** — this
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
} as const;

export type DemoCompanyKind = keyof typeof DEMO_COMPANIES;

/** Only these invented, dev-account fixtures may display synthetic work.
 * The caller must also verify dev auth; a customer workspace with the same
 * name must never acquire sample work by accident. */
export function isSampleWorkFixtureName(name: string): boolean {
  return name === "Digital Tailoring Supplies" ||
    name === "Sparrow Jam Manufacturing, OH" ||
    // The large development fixture (lib/db/northwind.ts). Local seeding only;
    // it has no card on the import page and cannot reach a hosted database.
    name === "Northwind Trading Group" ||
    name === DEMO_COMPANIES.small.name;
}
