/**
 * The orbital map's palette — the shipped "paper" register (Greg's call,
 * 2026-09-13), so this sits inside Zenhance rather than beside it.
 *
 * Colour is spent sparingly and only where it carries meaning: the map is
 * paper and ink, and the one place a hue appears is where a number needs a
 * verdict — team health, and a work item's status.
 */
export const C = {
  paper: "#f6f4ee",
  band: ["#f2efe6", "#eeeade", "#e9e5d7", "#e5e0d0"],
  bandRing: "#ded8c9",
  atmosphere: "#efece3",
  rung: "#b0a892",

  unitFill: "#ffffff",
  unitStroke: "#d3ccba",

  ink: "#22272e",
  inkSoft: "#5c6570",

  seat: "#6b727c",
  seatLead: "#22272e",
  seatOpen: "#ffffff",

  link: "#d9d3c4",
  seatLink: "#c9c2b0",
  dust: "#e7e2d4",

  /** Unfilled part of any progress ring. */
  track: "#e2ddcf",
  accent: "#10b981",
  alert: "#ef4444",
  white: "#ffffff",

  /** Verdict colours — the only hues on the map. */
  ok: "#10b981",
  watch: "#eab308",
  risk: "#ef4444",
} as const;

/** A work item's status, read at a glance. */
export const WORK_STATUS_FILL: Record<string, string> = {
  backlog: "#ded8c9",
  in_progress: "#5c6570",
  review: "#eab308",
  done: "#10b981",
};

export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

/**
 * Health is the one ring that renders a judgement rather than a quantity —
 * so it only reaches for colour when there is something to say. A healthy
 * team is drawn in ink like everything else; the map stays paper until it
 * needs to raise its hand.
 */
export const healthColor = (value: number): string =>
  value < 0.45 ? C.risk : value < 0.72 ? C.watch : C.inkSoft;
