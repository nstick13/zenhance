import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Zenhance",
  description:
    "Why Zenhance exists: the org that delivers value is not the org chart. We help delivery leaders see and shape the real, cross-functional structure.",
};

export default function AboutPage() {
  return (
    <>
      <section className="px-6 pb-12 pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            The org chart isn&apos;t the org
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
            The formal hierarchy of who-reports-to-whom is not the structure that actually ships
            work. Zenhance is built around that gap.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-2xl space-y-6 text-slate-300">
          <p>
            As an organization scales toward a few hundred people, delivery stops looking like a
            tree. People serve multiple teams at once. Contractors get bolted onto pods. Teams
            compose into teams-of-teams. The work flows across a living, cross-functional network —
            but the tools leaders reach for still draw a tidy reporting chart, or treat people and
            teams as an afterthought.
          </p>
          <p>
            So leaders fall back to spreadsheets: who&apos;s on what, at what allocation, costing
            what, delivering what. Those spreadsheets are where the real structure lives — and where
            it quietly breaks. Someone is on five teams. A critical pod is two people short of its
            target. A whole delivery group&apos;s cost has crept past its expected return, and
            nobody can see it until budget season.
          </p>
          <p>
            Zenhance turns that spreadsheet into a living map. Model the delivery org as it really
            is — groups, teams, contractor pods, and the people shared between them — and let the
            structure surface its own warnings: over-allocation, open roles, and cost/ROI rolled up
            the hierarchy. The goal is simple: make the org something a leader can <em>see</em>,
            reason about, and reshape with intent.
          </p>
        </div>
      </section>

      <section className="border-t border-slate-900 px-6 py-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See your own delivery org</h2>
        <p className="mx-auto mt-3 max-w-lg text-slate-400">
          Load the demo in one click, or bring your own spreadsheet.
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
