import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing — Zenhance",
  description: "Simple pricing for delivery leaders. Free to start, with plans that scale as your org grows.",
};

type Tier = {
  name: string;
  price: string;
  cadence?: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "$0",
    cadence: "free forever",
    tagline: "For an individual leader mapping a single org.",
    features: [
      "1 workspace",
      "Manual build + CSV/Excel import",
      "Radial delivery map with drill-down",
      "Allocation, gaps & cost/ROI overlays",
      "Scenario mode (in-session)",
    ],
    cta: "Get started",
    href: "/sign-up",
  },
  {
    name: "Team",
    price: "$29",
    cadence: "per month",
    tagline: "For a delivery team planning together.",
    features: [
      "Everything in Starter",
      "Saved & comparable scenarios",
      "Custom fields on people & teams",
      "Burnout-risk overlay",
      "Priority support",
    ],
    cta: "Get started",
    href: "/sign-up",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    tagline: "For organizations rolling out across many teams.",
    features: [
      "Everything in Team",
      "Workspace invites & roles (SSO)",
      "Live connectors (Jira / ADO / HRIS)",
      "Onboarding & dedicated support",
    ],
    cta: "Contact us",
    href: "/about",
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="px-6 pb-12 pt-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Simple, honest pricing
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
          Start free. Upgrade when your planning gets serious.
        </p>
        <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs text-fuchsia-300">
          Early access — all plans are free during beta
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto grid max-w-5xl grid-cols-1 items-start gap-6 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`flex h-full flex-col rounded-2xl border p-6 ${
                t.featured
                  ? "border-fuchsia-500/50 bg-gradient-to-b from-fuchsia-500/10 to-slate-900 shadow-xl shadow-fuchsia-500/10"
                  : "border-slate-800 bg-slate-900"
              }`}
            >
              {t.featured && (
                <span className="mb-3 inline-block w-fit rounded-full bg-fuchsia-500 px-2.5 py-0.5 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-slate-100">{t.name}</h3>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tracking-tight">{t.price}</span>
                {t.cadence && <span className="text-sm text-slate-500">{t.cadence}</span>}
              </div>
              <p className="mt-3 text-sm text-slate-400">{t.tagline}</p>

              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-300">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <span className="mt-0.5 text-fuchsia-400">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={t.href}
                className={`mt-8 rounded-md px-4 py-2.5 text-center text-sm font-semibold ${
                  t.featured
                    ? "bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20 hover:bg-fuchsia-400"
                    : "border border-slate-700 text-slate-200 hover:bg-slate-800"
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-xl text-center text-xs text-slate-600">
          Some plan features are on the roadmap and roll out during beta. Prices shown are introductory and may change.
        </p>
      </section>
    </>
  );
}
