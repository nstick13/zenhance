import type { Metadata } from "next";
import Link from "next/link";
import { MockupFrame } from "@/components/marketing/OrgMockup";

export const metadata: Metadata = {
  title: "Features — Zenhance",
  description:
    "A living radial map of your delivery org, with analytics overlays for allocation, gaps, and cost/ROI — plus drag-to-reorganize, scenario planning, and CSV import.",
};

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Radial delivery map",
    body: "Your org as a custom radial visualization — groups, teams, contractor pods, and people. Drill into any unit, zoom into members, and follow the people shared across multiple teams.",
  },
  {
    title: "Allocation overlay",
    body: "Instantly see who's stretched across too many teams. Over-allocated people are ringed and badged, and you can filter the whole map down to where the pressure is.",
  },
  {
    title: "Gaps & open roles",
    body: "Understaffed teams highlight against their target headcount, and open-role seats render as dashed placeholders you can fill — so hiring needs are visible, not buried.",
  },
  {
    title: "Cost & ROI rollups",
    body: "Headcount cost and expected ROI roll up the hierarchy, prorated by each person's allocation. Heat-tint the map by cost to defend the structure in budget reviews.",
  },
  {
    title: "Drag to reorganize",
    body: "Move a person onto another team to reassign them. Changes persist immediately — or hold them in scenario mode to plan a reorg before you commit.",
  },
  {
    title: "Import from a spreadsheet",
    body: "Upload a CSV or Excel file, map your columns to people, teams, and assignments, and Zenhance rebuilds the whole org in one transaction.",
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="px-6 pb-16 pt-20 text-center">
        <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Everything you need to{" "}
          <span className="bg-gradient-to-r from-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
            understand your org
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
          Not another box-and-line chart. A living model of how work actually flows through your teams.
        </p>
        <div className="mx-auto mt-14 max-w-3xl">
          <MockupFrame label="Zenhance — Allocation overlay" />
        </div>
      </section>

      <section className="border-t border-slate-900 px-6 py-20">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-lg font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-900 px-6 py-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See it on your own org</h2>
        <p className="mx-auto mt-3 max-w-lg text-slate-400">
          Start with the one-click demo org, then import or build your own.
        </p>
        <Link
          href="/sign-up"
          className="mt-8 inline-block rounded-md bg-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/20 hover:bg-fuchsia-400"
        >
          Get started free
        </Link>
      </section>
    </>
  );
}
