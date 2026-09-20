/**
 * Bright orbital palette: cool structure, vivid progress, quiet white space.
 */
export const C = {
  paper: "#fefefe",
  guide: "#b9c5ed",

  unitFill: "#ffffff",
  unitStroke: "#afbbf2",
  nodeShadow: "#5667b3",

  ink: "#222b58",
  inkSoft: "#6370a1",

  seat: "#6075d8",
  seatLead: "#6654c7",
  seatOpen: "#ffffff",

  link: "#c8d1f4",
  seatLink: "#bbcaeb",

  /** Unfilled part of any progress ring. */
  track: "#e0e8fb",
  accent: "#24bfdb",
  /** The route from the company to whatever you last clicked. Its own colour,
   *  not the accent: green already means "you're dragging this". */
  path: "#765ae8",
  alert: "#e95677",
  white: "#ffffff",

  delivery: "#5767e8",
  sprint: "#925cf2",
  health: "#24c6dd",

  /** Verdict colours — the only hues on the map. */
  ok: "#27c5da",
  watch: "#efa637",
  risk: "#e95677",
} as const;

/** A work item's status, read at a glance. */
export const WORK_STATUS_FILL: Record<string, string> = {
  backlog: "#c9d4ef",
  in_progress: "#6075d8",
  review: "#925cf2",
  done: "#24bfdb",
};

export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

/**
 * The health ring stays cyan when healthy, shifting warm only when needed.
 */
export const healthColor = (value: number): string =>
  value < 0.45 ? C.risk : value < 0.72 ? C.watch : C.health;
