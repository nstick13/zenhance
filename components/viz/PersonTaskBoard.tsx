"use client";

import { useMemo, useState } from "react";
import type { CanvasPerson } from "@/lib/canvas/buildCanvasMap";
import {
  tasksForPerson,
  STATUS_ORDER,
  STATUS_LABELS,
  type MockTask,
  type TaskStatus,
} from "@/lib/mock/personTasks";

/**
 * The deepest rung of the zoom ladder: "click into" a person the way you'd
 * click into a building in a city builder, and see the work they're
 * carrying. Mock data only (lib/mock/personTasks.ts) — there is no real work
 * entity yet (docs/ROADMAP.md). This is a feel study for customer research,
 * built as a real screen (not a throwaway lab route) per Greg's call:
 * git history is the undo button.
 *
 * Deliberately DOM/CSS, not Konva — the canvas is a spatial map; a kanban
 * board is a reading surface, and forcing it onto canvas would fight the
 * grain of both. It replaces the whole scene (topbar included) rather than
 * living inside the side panel, so the mode-change reads as "somewhere new,"
 * not "more panel."
 */

// --- palette — mirrors OrgCanvas's "paper" register (components/viz/OrgCanvas.tsx C) ---
const P = {
  paper: "#f6f4ee",
  ink: "#22272e",
  inkSoft: "#5c6570",
  line: "#e4e0d6",
  white: "#ffffff",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

const STATUS_ACCENT: Record<TaskStatus, string> = {
  backlog: "#8b93a1",
  in_progress: "#eab308",
  review: "#6366f1",
  done: "#22c55e",
};

const PRIORITY_DOT: Record<MockTask["priority"], string> = {
  low: "#8b93a1",
  medium: "#eab308",
  high: "#ef4444",
};

function nextStatus(s: TaskStatus): TaskStatus {
  const i = STATUS_ORDER.indexOf(s);
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
}

export default function PersonTaskBoard({
  person,
  accent,
  teamNames,
  onBack,
}: {
  person: CanvasPerson;
  accent: string;
  teamNames: string[];
  onBack: () => void;
}) {
  // Keyed by person.id from the caller, so switching people remounts this
  // (fresh board) rather than needing an effect to reset state.
  const [tasks, setTasks] = useState<MockTask[]>(() => tasksForPerson(person, teamNames));
  const [bumped, setBumped] = useState<string | null>(null);

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, MockTask[]>(STATUS_ORDER.map((s) => [s, []]));
    for (const t of tasks) m.get(t.status)!.push(t);
    return m;
  }, [tasks]);

  const doneCount = byStatus.get("done")!.length;
  const total = tasks.length;

  function advance(id: string) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: nextStatus(t.status) } : t)));
    setBumped(id);
    window.setTimeout(() => setBumped((b) => (b === id ? null : b)), 360);
  }

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes ztb-pop-in {
          from { opacity: 0; transform: translateY(10px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes ztb-bump {
          0% { transform: scale(1); }
          40% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
        @keyframes ztb-scene-in {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        .ztb-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 14px rgba(34,39,46,0.12);
          border-color: ${P.inkSoft};
        }
      `}</style>
      <div style={{ ...styles.scene, animation: "ztb-scene-in 260ms ease-out" }}>
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={onBack} aria-label="Back to map">
            ← Back to map
          </button>
          <div style={styles.identity}>
            <div style={{ ...styles.avatar, background: accent }}>{initials(person.name)}</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{person.name}</div>
              <div style={{ fontSize: 13, color: P.inkSoft }}>
                {person.title ?? "—"}
                {teamNames.length > 0 ? ` · ${teamNames.join(", ")}` : ""}
              </div>
            </div>
          </div>
          <div style={styles.progressWrap}>
            <div style={styles.progressLabel}>
              {doneCount} / {total} done
            </div>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${total > 0 ? (100 * doneCount) / total : 0}%`,
                }}
              />
            </div>
          </div>
        </div>

        <div style={styles.board}>
          {STATUS_ORDER.map((status) => {
            const items = byStatus.get(status)!;
            return (
              <div key={status} style={styles.column}>
                <div style={styles.columnHead}>
                  <span style={{ ...styles.statusDot, background: STATUS_ACCENT[status] }} />
                  <span style={styles.columnTitle}>{STATUS_LABELS[status]}</span>
                  <span style={styles.columnCount}>{items.length}</span>
                </div>
                <div style={styles.columnBody}>
                  {items.length === 0 && <div style={styles.emptyHint}>Nothing here</div>}
                  {items.map((t, i) => (
                    <button
                      key={t.id}
                      className="ztb-card"
                      onClick={() => advance(t.id)}
                      title="Click to move to the next stage"
                      style={{
                        ...styles.card,
                        animation:
                          bumped === t.id
                            ? "ztb-bump 360ms ease-out"
                            : `ztb-pop-in 260ms ease-out both`,
                        animationDelay: bumped === t.id ? "0ms" : `${i * 35}ms`,
                        opacity: status === "done" ? 0.75 : 1,
                      }}
                    >
                      <div style={styles.cardTop}>
                        <span style={{ ...styles.priorityDot, background: PRIORITY_DOT[t.priority] }} />
                        <span style={styles.cardTag}>{t.tag}</span>
                        <span style={styles.cardPoints}>{t.points}</span>
                      </div>
                      <div
                        style={{
                          ...styles.cardTitle,
                          textDecoration: status === "done" ? "line-through" : "none",
                        }}
                      >
                        {status === "done" ? "✓ " : ""}
                        {t.title}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

const styles = {
  root: {
    position: "absolute" as const,
    inset: 0,
    background: P.paper,
    zIndex: 40,
    display: "flex",
    flexDirection: "column" as const,
    fontFamily: FONT,
    color: P.ink,
  },
  scene: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "14px 20px",
    borderBottom: `1px solid ${P.line}`,
    flexWrap: "wrap" as const,
  },
  backBtn: {
    height: 38,
    padding: "0 14px",
    borderRadius: 10,
    border: `1px solid ${P.line}`,
    background: P.white,
    color: P.ink,
    fontFamily: FONT,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  identity: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginRight: "auto",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    color: P.white,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 14,
    flexShrink: 0,
  },
  progressWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    minWidth: 160,
  },
  progressLabel: {
    fontSize: 11.5,
    fontWeight: 700,
    color: P.inkSoft,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  progressTrack: {
    width: 160,
    height: 6,
    borderRadius: 999,
    background: P.line,
    overflow: "hidden" as const,
  },
  progressFill: {
    height: "100%",
    background: STATUS_ACCENT.done,
    borderRadius: 999,
    transition: "width 320ms ease-out",
  },
  board: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
    gap: 14,
    padding: 20,
    overflow: "auto" as const,
  },
  column: {
    background: "#efece2",
    borderRadius: 14,
    display: "flex",
    flexDirection: "column" as const,
    minHeight: 0,
  },
  columnHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 12px 8px",
  },
  statusDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  columnTitle: { fontSize: 12.5, fontWeight: 700, color: P.ink, textTransform: "uppercase" as const, letterSpacing: "0.04em" },
  columnCount: { marginLeft: "auto", fontSize: 12, color: P.inkSoft, fontVariantNumeric: "tabular-nums" as const },
  columnBody: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: "0 10px 12px",
    overflowY: "auto" as const,
  },
  emptyHint: { fontSize: 12, color: P.inkSoft, padding: "10px 4px", fontStyle: "italic" as const },
  card: {
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    background: P.white,
    border: `1px solid ${P.line}`,
    borderRadius: 10,
    padding: "10px 11px",
    cursor: "pointer",
    fontFamily: FONT,
    boxShadow: "0 1px 2px rgba(34,39,46,0.06)",
    transition: "transform 160ms ease-out, box-shadow 160ms ease-out",
  },
  cardTop: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 },
  priorityDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  cardTag: {
    fontSize: 10.5,
    color: P.inkSoft,
    background: P.paper,
    borderRadius: 999,
    padding: "2px 7px",
    fontWeight: 600,
  },
  cardPoints: {
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: 700,
    color: P.inkSoft,
    fontVariantNumeric: "tabular-nums" as const,
  },
  cardTitle: { fontSize: 13, color: P.ink, lineHeight: 1.35 },
};
