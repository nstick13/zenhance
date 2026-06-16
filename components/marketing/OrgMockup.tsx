/**
 * Static SVG illustration of the radial delivery-org view, for marketing pages.
 * Not the real viz (that's components/viz/RadialOrg) — just an evocative mockup
 * with an allocation-warning badge to hint at the analytics.
 */
export function OrgMockup() {
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
      {/* allocation warning badge on the over-allocated person */}
      <circle cx={nodes[8].x + 10} cy={nodes[8].y - 10} r={7} fill="#f59e0b" />
      <text x={nodes[8].x + 10} y={nodes[8].y - 10} textAnchor="middle" dominantBaseline="middle" fill="#000" fontSize={8} fontWeight="bold">!</text>
    </svg>
  );
}

/** Browser-chrome frame around the mockup. Reused on home + features. */
export function MockupFrame({ label = "Zenhance — Delivery Group" }: { label?: string }) {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        <span className="ml-3 text-xs text-slate-500">{label}</span>
      </div>
      <OrgMockup />
    </div>
  );
}
