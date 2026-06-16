"use client";

/**
 * ANALYTICS LOOK-AND-FEEL LAB — throwaway design sandbox.
 *
 * Not wired to the DB, auth, or the real viz. Hardcoded mock data only.
 * Concept under test: "analytics as places."
 *   - AMBIENT (nothing selected): every finding is marked on the map at once,
 *     equally — presence, not priority. Count dots per team (count is a fact,
 *     not a verdict). Colour = category, NOT severity (no hue means "bad").
 *   - FOCUS (a finding selected): the map flies there & spotlights it; the
 *     card expands from Signal (stat at rest) to Narrative (story on focus).
 *
 * View at /lab/analytics in dev. Delete the app/lab folder when done.
 */

import { useState, type ReactNode } from "react";

const GOLD = "#f5c542";
const BG0 = "#070a12";
const BG1 = "#0d1322";

// --- map geometry (mock of the radial org) --------------------------------
const CENTER = { x: 450, y: 380 };
const TEAMS = {
  starlight: { x: 250, y: 200, label: "Starlight", members: 5 },
  earthlight: { x: 650, y: 200, label: "Earthlight", members: 4 },
  moonlight: { x: 250, y: 540, label: "Moonlight", members: 3 },
  infosys: { x: 650, y: 540, label: "Infosys Contractors", members: 4 },
} as const;
type TeamId = keyof typeof TEAMS;

type Finding = {
  id: string;
  // category colour — distinct per type, deliberately NOT ordered by "badness"
  color: string;
  kind: string;
  stat: string;
  statSub: string;
  narrative: ReactNode;
  involved: TeamId[];
  // visual style of the spotlight when focused
  spotlight: "hub" | "ribbon" | "team";
  landing: string;
};

export default function AnalyticsLab() {
  const [selected, setSelected] = useState<string | null>(null);

  const FINDINGS: Finding[] = [
    {
      id: "overalloc",
      color: "#ff7a8a",
      kind: "Over-allocation",
      stat: "165%",
      statSub: "Aisha Khan · 5 teams",
      narrative: (
        <>
          <b>Aisha Khan</b> is spread across <b>5 teams</b> at <b>165%</b> —
          past breaking point, and four of them depend on her.
        </>
      ),
      involved: ["starlight", "earthlight", "moonlight", "infosys"],
      spotlight: "hub",
      landing: "Aisha Khan — 5 teams, 165% allocated",
    },
    {
      id: "spof",
      color: "#b98bff",
      kind: "Single point of failure",
      stat: "1",
      statSub: "Security · 4 teams",
      narrative: (
        <>
          Security is <b>one person — Marco</b> — covering <b>4 teams</b>. No
          backup anywhere. If he's out, four teams stall.
        </>
      ),
      involved: ["starlight", "earthlight", "moonlight", "infosys"],
      spotlight: "hub",
      landing: "Marco Reyes — sole Security across 4 teams",
    },
    {
      id: "outsourcing",
      color: "#4fd1b0",
      kind: "Outsourcing exposure",
      stat: "38%",
      statSub: "of delivery is vendor",
      narrative: (
        <>
          <b>38%</b> of delivery runs on contractors. <b>Infosys</b> alone is{" "}
          <b>2 of your critical teams</b>' majority.
        </>
      ),
      involved: ["infosys"],
      spotlight: "team",
      landing: "Infosys Contractors — 38% of total delivery",
    },
    {
      id: "coupling",
      color: "#f5b14a",
      kind: "Hidden coupling",
      stat: "3",
      statSub: "shared · Starlight ↔ Moonlight",
      narrative: (
        <>
          <b>Starlight</b> and <b>Moonlight</b> share <b>3 people</b> — on paper
          they're separate, in practice they're <b>one team</b>.
        </>
      ),
      involved: ["starlight", "moonlight"],
      spotlight: "ribbon",
      landing: "Starlight ↔ Moonlight — 3 shared members",
    },
    {
      id: "distribution",
      color: "#5bb0ff",
      kind: "Distribution drag",
      stat: "6",
      statSub: "time zones in one team",
      narrative: (
        <>
          <b>Earthlight</b> spans <b>6 time zones</b> with almost{" "}
          <b>no overlap hours</b>. Standups happen at someone's midnight.
        </>
      ),
      involved: ["earthlight"],
      spotlight: "team",
      landing: "Earthlight — 6 time zones, ~0 overlap",
    },
  ];

  const active = FINDINGS.find((f) => f.id === selected) ?? null;
  const ambient = active === null;
  const isInvolved = (t: TeamId) => !active || active.involved.includes(t);

  // for ambient presence dots: which findings touch each team (count = a fact)
  const findingsOnTeam = (t: TeamId) => FINDINGS.filter((f) => f.involved.includes(t));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(120% 100% at 50% 0%, ${BG1}, ${BG0})`,
        color: "#e9edf6",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        display: "grid",
        gridTemplateColumns: "1fr 380px",
      }}
    >
      <style>{`
        @keyframes pulseRing { 0%{opacity:.55; transform:scale(1)} 70%{opacity:0; transform:scale(2.1)} 100%{opacity:0} }
        @keyframes dash { to { stroke-dashoffset: -24; } }
        @keyframes floatIn { from{opacity:0; transform:translateY(8px)} to{opacity:1; transform:translateY(0)} }
        @keyframes ambientPulse { 0%,100%{opacity:.45} 50%{opacity:.9} }
        .finding-card { animation: floatIn .25s ease both; }
        .thread { stroke-dasharray: 6 6; animation: dash 1s linear infinite; }
        .amb { animation: ambientPulse 3s ease-in-out infinite; }
      `}</style>

      {/* ---------- MAP STAGE ---------- */}
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 22,
            left: 26,
            fontSize: 12,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "#7d8aa6",
          }}
        >
          Analytics lab · Delivery Group
        </div>

        <svg viewBox="0 0 900 760" style={{ width: "100%", height: "100vh" }}>
          <defs>
            <radialGradient id="node" cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#fff3c4" />
              <stop offset="42%" stopColor={GOLD} />
              <stop offset="100%" stopColor="#7a5a10" />
            </radialGradient>
            <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="7" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* base spokes */}
          {(Object.keys(TEAMS) as TeamId[]).map((id) => {
            const t = TEAMS[id];
            return (
              <line
                key={`spoke-${id}`}
                x1={CENTER.x}
                y1={CENTER.y}
                x2={t.x}
                y2={t.y}
                stroke={GOLD}
                strokeWidth={2}
                strokeOpacity={isInvolved(id) ? 0.35 : 0.08}
              />
            );
          })}

          {/* ---- FOCUS spotlight overlay ---- */}
          {active?.spotlight === "ribbon" && (
            <path
              d={`M ${TEAMS.starlight.x} ${TEAMS.starlight.y} Q 360 380 ${TEAMS.moonlight.x} ${TEAMS.moonlight.y}`}
              fill="none"
              stroke={active.color}
              strokeWidth={5}
              strokeOpacity={0.85}
              className="thread"
            />
          )}
          {active?.spotlight === "hub" && (
            <>
              {active.involved.map((id) => (
                <line
                  key={`hub-${id}`}
                  x1={CENTER.x}
                  y1={CENTER.y}
                  x2={TEAMS[id].x}
                  y2={TEAMS[id].y}
                  stroke={active.color}
                  strokeWidth={3}
                  strokeOpacity={0.85}
                  className="thread"
                />
              ))}
              <circle cx={CENTER.x} cy={CENTER.y} r={20} fill={active.color} opacity={0.9} />
              <circle
                cx={CENTER.x}
                cy={CENTER.y}
                r={20}
                fill="none"
                stroke={active.color}
                strokeWidth={2}
                style={{
                  transformOrigin: `${CENTER.x}px ${CENTER.y}px`,
                  animation: "pulseRing 1.6s ease-out infinite",
                }}
              />
            </>
          )}

          {/* center node */}
          <g opacity={active && active.spotlight !== "hub" ? 0.4 : 1}>
            <circle cx={CENTER.x} cy={CENTER.y} r={30} fill="url(#node)" filter="url(#glow)" />
            <text x={CENTER.x} y={CENTER.y + 56} textAnchor="middle" fill="#fff" fontSize={16} fontWeight={600}>
              Delivery Group
            </text>
          </g>

          {/* team nodes */}
          {(Object.keys(TEAMS) as TeamId[]).map((id) => {
            const t = TEAMS[id];
            const on = isInvolved(id);
            const focusRing = active && active.involved.includes(id) ? active.color : null;
            const dots = findingsOnTeam(id);
            return (
              <g key={id} opacity={on ? 1 : 0.3}>
                {/* FOCUS ring */}
                {focusRing && (
                  <circle
                    cx={t.x}
                    cy={t.y}
                    r={26}
                    fill="none"
                    stroke={focusRing}
                    strokeWidth={3}
                    style={{
                      transformOrigin: `${t.x}px ${t.y}px`,
                      animation: "pulseRing 1.8s ease-out infinite",
                    }}
                  />
                )}
                <circle cx={t.x} cy={t.y} r={22} fill="url(#node)" filter="url(#glow)" />

                {/* AMBIENT presence dots — fanned above the node, one per finding touching this team */}
                {ambient &&
                  dots.map((f, i) => {
                    const spread = 18; // px between dots
                    const total = (dots.length - 1) * spread;
                    const dx = t.x - total / 2 + i * spread;
                    const dy = t.y - 40;
                    return (
                      <circle
                        key={`amb-${id}-${f.id}`}
                        className="amb"
                        cx={dx}
                        cy={dy}
                        r={5}
                        fill={f.color}
                        stroke="#0a0f1c"
                        strokeWidth={1.5}
                      />
                    );
                  })}

                <text x={t.x} y={t.y + 44} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={600}>
                  {t.label}
                </text>
                <text x={t.x} y={t.y + 62} textAnchor="middle" fill="#8a96b0" fontSize={11}>
                  {t.members} members
                </text>
              </g>
            );
          })}
        </svg>

        {/* caption: ambient hint vs focus landing */}
        <div
          className="finding-card"
          key={active?.id ?? "ambient"}
          style={{
            position: "absolute",
            bottom: 34,
            left: 26,
            padding: "10px 16px",
            borderRadius: 12,
            background: "rgba(13,19,34,.82)",
            border: `1px solid ${active ? active.color + "55" : "#26304a"}`,
            backdropFilter: "blur(8px)",
            fontSize: 13,
            maxWidth: 420,
            color: active ? "#e9edf6" : "#9fb0c9",
          }}
        >
          {active ? (
            <>
              <span style={{ color: active.color, fontWeight: 700 }}>◉ </span>
              {active.landing}
            </>
          ) : (
            <>Every flag is marked on the map — equal weight, no ranking. Pick one to focus.</>
          )}
        </div>
      </div>

      {/* ---------- FINDINGS RAIL ---------- */}
      <div
        style={{
          borderLeft: "1px solid #1b2236",
          background: "rgba(8,11,20,.6)",
          padding: "22px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".02em" }}>
          What we found
          <span style={{ color: "#7d8aa6", fontWeight: 500 }}> · {FINDINGS.length}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
          {FINDINGS.map((f) => {
            const on = selected === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setSelected(on ? null : f.id)}
                className="finding-card"
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  border: `1px solid ${on ? f.color : "#1d2740"}`,
                  background: on ? "rgba(20,27,46,.9)" : "rgba(14,20,36,.6)",
                  borderRadius: 14,
                  padding: "14px 16px",
                  boxShadow: on ? `0 0 0 1px ${f.color}33, 0 8px 30px -12px ${f.color}66` : "none",
                  transition: "border-color .15s, background .15s",
                  color: "#e9edf6",
                }}
              >
                {/* Signal row — always shown (at-rest state) */}
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ minWidth: 60 }}>
                    <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: f.color }}>
                      {f.stat}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: f.color }} />
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{f.kind}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#94a2bd" }}>{f.statSub}</div>
                  </div>
                  <span
                    style={{
                      color: f.color,
                      opacity: 0.6,
                      fontSize: 12,
                      transform: on ? "rotate(90deg)" : "none",
                      transition: "transform .2s",
                    }}
                  >
                    ›
                  </span>
                </div>

                {/* Narrative — revealed on focus (expanded state) */}
                {on && (
                  <div
                    className="finding-card"
                    style={{
                      marginTop: 13,
                      paddingTop: 13,
                      borderTop: `1px solid ${f.color}22`,
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      color: "#dbe2f0",
                    }}
                  >
                    {f.narrative}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: "auto", fontSize: 11, color: "#5e6b85", lineHeight: 1.5 }}>
          Ambient = all flags present, colour by category (not severity), count
          dots per team. Click = focus + spotlight. Throwaway lab, not real data.
        </div>
      </div>
    </div>
  );
}
