import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth/currentUser";
import { MockupFrame } from "@/components/marketing/OrgMockup";

export const metadata: Metadata = {
  title: "Zenhance — See how your teams actually work",
  description:
    "Map the real, cross-functional delivery org — shared people, contractor pods, teams-of-teams — and surface allocation gaps, open roles, and cost/ROI in one living radial view.",
};

export default async function HomePage() {
  const userId = await getUserId();
  if (userId) redirect("/org");

  return (
    <>
      {/* Hero */}
      <section className="flex flex-col items-center px-6 pb-20 pt-20 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs text-fuchsia-300">
          Your delivery org, not your HR chart
        </div>

        <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          See how your teams{" "}
          <span className="bg-gradient-to-r from-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
            actually work
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-lg text-slate-400">
          Zenhance maps the real delivery structure — cross-functional teams, shared people,
          contractor pods — and surfaces allocation gaps, open roles, and cost/ROI in one
          living radial view.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/sign-up"
            className="rounded-md bg-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/20 hover:bg-fuchsia-400"
          >
            Get started free
          </Link>
          <Link
            href="/features"
            className="rounded-md border border-slate-700 px-6 py-3 text-sm font-semibold hover:bg-slate-800"
          >
            See the features
          </Link>
        </div>

        <div className="mt-16 w-full max-w-3xl">
          <MockupFrame />
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-900 px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            From spreadsheet to living map in minutes
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
            <Step
              n={1}
              title="Bring your org in"
              body="Build it by hand or import people, teams, and assignments straight from a CSV or Excel sheet."
            />
            <Step
              n={2}
              title="See the real structure"
              body="Watch it render as a radial map — drill into teams, zoom into members, and follow who's shared across pods."
            />
            <Step
              n={3}
              title="Surface what's hidden"
              body="Toggle overlays for over-allocation, open roles, and cost/ROI rolled up the hierarchy."
            />
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="border-t border-slate-900 px-6 py-20">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3">
          <ValueCard
            title="Delivery structure, not HR"
            body="Model real cross-functional teams and contractor pods. See who's on what — not who reports to whom."
          />
          <ValueCard
            title="Allocation at a glance"
            body="Spot over-allocated people and under-staffed teams instantly. Color-coded heat shows exactly where the pressure is."
          />
          <ValueCard
            title="Cost & ROI rolled up"
            body="Every team rolls up headcount cost and expected ROI so you can defend the structure in the next budget conversation."
          />
        </div>
      </section>

      {/* CTA band */}
      <section className="border-t border-slate-900 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/10 to-indigo-500/10 px-8 py-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to see your delivery org?
          </h2>
          <p className="mt-3 text-slate-400">
            Load the demo org in one click, or build your own. Free to start.
          </p>
          <Link
            href="/sign-up"
            className="mt-8 inline-block rounded-md bg-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/20 hover:bg-fuchsia-400"
          >
            Get started free
          </Link>
        </div>
      </section>
    </>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="text-center sm:text-left">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 text-sm font-semibold text-fuchsia-300 sm:mx-0">
        {n}
      </div>
      <h3 className="font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{body}</p>
    </div>
  );
}

function ValueCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{body}</p>
    </div>
  );
}
