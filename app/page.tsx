import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth/currentUser";

export default async function LandingPage() {
  const userId = await getUserId();
  if (userId) redirect("/org");
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">
          <span className="text-fuchsia-400">Zen</span>hance
        </span>
        <Link
          href="/sign-in"
          className="rounded-md border border-slate-700 px-4 py-1.5 text-sm hover:bg-slate-800"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 pt-16 text-center">
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
            href="/sign-in"
            className="rounded-md border border-slate-700 px-6 py-3 text-sm font-semibold hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>

        {/* Viz mockup */}
        <div className="relative mt-16 w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
            <span className="ml-3 text-xs text-slate-500">Zenhance — Delivery Group</span>
          </div>
          <OrgMockup />
        </div>
      </main>

      {/* Value props */}
      <section className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 px-6 pb-24 sm:grid-cols-3">
        <ValueCard
          title="Delivery structure, not HR"
          body="Model real cross-functional teams and contractor pods. See who's on what — not who reports to whom."
        />
        <ValueCard
          title="Allocation at a glance"
          body="Spot over-allocated people and under-staffed teams instantly. Color-coded heat tints show you exactly where the pressure is."
        />
        <ValueCard
          title="Cost & ROI rolled up"
          body="Every team rolls up headcount cost and expected ROI so you can defend the structure in the next budget conversation."
        />
      </section>

      <footer className="border-t border-slate-800 px-6 py-6 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} Zenhance
      </footer>
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

function OrgMockup() {
  const CX = 420;
  const CY = 220;
  const nodes: { label: string; x: number; y: number; r: number; color: string }[] = [
    { label: "Delivery Group", x: CX, y: CY, r: 46, color: "#a855f7" },
    { label: "Starlight", x: CX - 160, y: CY - 120, r: 34, color: "#818cf8" },
    { label: "Moonlight", x: CX + 165, y: CY - 110, r: 32, color: "#818cf8" },
    { label: "Earthlight", x: CX - 170, y: CY + 120, r: 34, color: "#818cf8" },
    { label: "Infosys", x: CX + 155, y: CY + 120, r: 30, color: "#64748b" },
    { label: "S. Reeve", x: CX, y: CY - 185, r: 18, color: "#e879f9" },
    { label: "A. Bradford", x: CX - 270, y: CY - 80, r: 16, color: "#c084fc" },
    { label: "T. Le", x: CX - 300, y: CY + 30, r: 14, color: "#c084fc" },
    { label: "A. Smith", x: CX + 260, y: CY - 60, r: 14, color: "#f59e0b" },
    { label: "A. Richter", x: CX - 265, y: CY + 155, r: 16, color: "#c084fc" },
    { label: "M. Webb", x: CX + 270, y: CY + 80, r: 14, color: "#c084fc" },
  ];

  const links = [0, 1, 2, 3, 4].map((i) => ({ from: 0, to: i + 1 })).concat(
    [{ from: 1, to: 5 }, { from: 1, to: 6 }, { from: 1, to: 7 }, { from: 2, to: 8 }, { from: 3, to: 9 }, { from: 4, to: 10 }],
  );

  return (
    <svg viewBox="0 0 840 440" className="w-full" aria-hidden>
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#1e1b2e" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <rect width="840" height="440" fill="url(#bg)" />
      {links.map((l, i) => (
        <line
          key={i}
          x1={nodes[l.from].x}
          y1={nodes[l.from].y}
          x2={nodes[l.to].x}
          y2={nodes[l.to].y}
          stroke="#334155"
          strokeWidth={1.5}
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} fillOpacity={0.18} stroke={n.color} strokeWidth={1.5} />
          <text
            x={n.x}
            y={n.y + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={n.color}
            fontSize={n.r > 30 ? 9 : 7}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight="600"
          >
            {n.label}
          </text>
        </g>
      ))}
      {/* allocation warning badge */}
      <circle cx={nodes[8].x + 10} cy={nodes[8].y - 10} r={7} fill="#f59e0b" />
      <text x={nodes[8].x + 10} y={nodes[8].y - 10} textAnchor="middle" dominantBaseline="middle" fill="#000" fontSize={8} fontWeight="bold">!</text>
    </svg>
  );
}
