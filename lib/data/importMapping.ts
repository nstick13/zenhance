/**
 * Import-time normalisation for the S2 person attributes.
 *
 * Pure: no React, no DB, no server-action boundary — so the wizard can preview
 * exactly what the commit will do, and both sides agree by construction.
 *
 * The governing assumption (Heather, 2026-08-27): *"I don't think we're ever
 * going to get good data. I mean, anywhere."* So nothing here blocks an import.
 * An unrecognised value degrades to null and is reported as a warning; the org
 * still lands, and the gap is visible on the map as a gap.
 */

export type EmploymentValue = "fte" | "contractor" | "vendor" | "unknown";

// --- employment -----------------------------------------------------------
/**
 * A fixed enum, not a workspace list (see schema.ts): "contractor" has to mean
 * the same thing in every workspace for outsourcing exposure to be comparable.
 * That makes normalising the spreadsheet's vocabulary our problem, not the
 * customer's.
 */
const EMPLOYMENT_ALIASES: Record<Exclude<EmploymentValue, "unknown">, string[]> = {
  fte: [
    "fte", "ft", "full time", "fulltime", "full-time", "permanent", "perm",
    "employee", "staff", "internal", "badge", "direct", "salaried", "regular",
  ],
  contractor: [
    "contractor", "contract", "contingent", "temp", "temporary", "freelance",
    "freelancer", "consultant", "cw", "c2c", "t&m", "agency", "non-employee",
  ],
  vendor: [
    "vendor", "supplier", "partner", "outsourced", "outsource", "offshore",
    "managed service", "msp", "third party", "3rd party", "external",
  ],
};

/** Spreadsheet employment value → the fixed enum. Unrecognised → "unknown". */
export function normalizeEmployment(raw?: string | null): EmploymentValue {
  const v = (raw ?? "").trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
  if (!v) return "unknown";
  for (const [value, aliases] of Object.entries(EMPLOYMENT_ALIASES)) {
    if (aliases.includes(v)) return value as EmploymentValue;
  }
  // Substring pass, so "Contractor (Infosys)" and "Full-Time Employee" land.
  for (const [value, aliases] of Object.entries(EMPLOYMENT_ALIASES)) {
    if (aliases.some((a) => a.length >= 4 && v.includes(a))) return value as EmploymentValue;
  }
  return "unknown";
}

// --- timezone -------------------------------------------------------------
/**
 * Powers distribution drag, so it has to be a real IANA zone to be comparable.
 * HRIS exports rarely oblige — they emit "EST", "GMT+1", or a city — so the
 * common shapes are mapped rather than rejected.
 */
const TZ_ALIASES: Record<string, string> = {
  // US
  et: "America/New_York", est: "America/New_York", edt: "America/New_York",
  eastern: "America/New_York", ct: "America/Chicago", cst: "America/Chicago",
  cdt: "America/Chicago", central: "America/Chicago", mt: "America/Denver",
  mst: "America/Denver", mdt: "America/Denver", mountain: "America/Denver",
  pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles",
  pacific: "America/Los_Angeles",
  // Europe
  gmt: "Europe/London", utc: "UTC", z: "UTC", bst: "Europe/London",
  uk: "Europe/London", london: "Europe/London",
  cet: "Europe/Berlin", cest: "Europe/Berlin", eet: "Europe/Helsinki",
  // Asia-Pacific / other common delivery-centre zones
  ist: "Asia/Kolkata", india: "Asia/Kolkata", sgt: "Asia/Singapore",
  jst: "Asia/Tokyo", aest: "Australia/Sydney", aedt: "Australia/Sydney",
  brt: "America/Sao_Paulo", gst: "Asia/Dubai",
};

/** True if the runtime's ICU accepts this as an IANA zone. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The runtime's canonical spelling of a zone, or null. Also collapses ICU
 * aliases ("Asia/Calcutta" → "Asia/Kolkata"), which is what we want: two
 * spellings of one zone must not read as two locations.
 */
function canonicalTimezone(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Spreadsheet timezone → IANA name, or null if it can't be resolved.
 * Null is deliberate: a wrong zone is worse than a missing one, because
 * distribution drag would then report a spread that isn't real.
 */
export function normalizeTimezone(raw?: string | null): string | null {
  const input = (raw ?? "").trim();
  if (!input) return null;

  // Already IANA ("Europe/Berlin"), possibly with odd casing. ICU matches zone
  // names case-insensitively, so ask it for the canonical spelling rather than
  // trusting the sheet's — otherwise "europe/berlin" is stored verbatim and
  // never groups with "Europe/Berlin".
  if (input.includes("/")) {
    return canonicalTimezone(input);
  }

  const key = input.toLowerCase().replace(/[.\s]+/g, "");
  if (TZ_ALIASES[key]) return TZ_ALIASES[key];

  // "GMT+1" / "UTC-05:00" / "+05:30" → Etc/GMT±N. Etc/GMT signs are inverted
  // by the POSIX convention, which is exactly the sort of thing that would
  // otherwise silently mislabel half of Europe.
  const offset = key.match(/^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (offset) {
    const [, sign, hh, mm] = offset;
    if (mm && mm !== "00") return null; // Etc/GMT can't express half-hour zones
    const hours = parseInt(hh, 10);
    if (hours > 14) return null;
    if (hours === 0) return "UTC";
    return `Etc/GMT${sign === "+" ? "-" : "+"}${hours}`;
  }

  return null;
}

// --- title → discipline ---------------------------------------------------
/**
 * Most orgs' exports carry a title and nothing else. Without this the
 * analyzable field stays empty and quietly disables half the findings
 * (bus factor, role coverage, the pod template), so the suggestion is the
 * point of S2's import work — not a convenience.
 *
 * Order matters: first match wins, and the specific rules sit above the
 * general ones. "QA Engineer" must not read as Engineering; "Product Manager"
 * must not read as Management.
 */
export const DISCIPLINE_RULES: { discipline: string; keywords: string[] }[] = [
  { discipline: "QA", keywords: ["qa", "quality assurance", "quality engineer", "sdet", "tester", "test engineer", "test automation", "automation engineer"] },
  { discipline: "Security", keywords: ["security", "appsec", "infosec", "secops", "penetration test", "pen test"] },
  { discipline: "Data", keywords: ["data engineer", "data scientist", "data analyst", "data architect", "analytics engineer", "machine learning", "ml engineer", "ai engineer", "business intelligence", "bi developer"] },
  { discipline: "Design", keywords: ["designer", "design lead", "ux", "ui designer", "user experience", "user research", "researcher", "content design"] },
  { discipline: "Product", keywords: ["product manager", "product owner", "product lead", "product director", "head of product", "product analyst"] },
  { discipline: "Delivery", keywords: ["scrum master", "delivery manager", "delivery lead", "agile coach", "release train engineer", "rte", "project manager", "programme manager", "program manager", "delivery"] },
  { discipline: "Platform", keywords: ["sre", "site reliability", "platform engineer", "platform lead", "infrastructure", "devops", "cloud engineer", "systems engineer", "network engineer"] },
  { discipline: "Management", keywords: ["engineering manager", "development manager", "director", "vp ", "vice president", "head of", "cto", "chief"] },
  { discipline: "Engineering", keywords: ["software engineer", "engineer", "developer", "swe", "programmer", "architect", "tech lead", "technical lead", "full stack", "fullstack", "frontend", "front end", "backend", "back end", "mobile", "ios", "android", "development"] },
  { discipline: "Support", keywords: ["support", "service desk", "help desk", "operations analyst", "ops analyst", "technical writer"] },
];

const normTitle = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9+ ]+/g, " ").replace(/\s+/g, " ").trim()} `;

/**
 * A crude stem, just enough to let a title and a discipline name meet in the
 * middle: "Software Engineer" has to find an existing "Software Engineering",
 * or every import invents a near-duplicate beside the taxonomy the workspace
 * already curated. Deliberately shallow — over-stemming would collide terms
 * that a taxonomy keeps apart.
 */
function stem(word: string): string {
  let w = word;
  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  if (w.endsWith("er") && w.length > 5) w = w.slice(0, -2);
  return w;
}

const stemTokens = (s: string) => normTitle(s).trim().split(" ").filter(Boolean).map(stem);

/** True if `needle`'s words appear as a contiguous run inside `hay`'s. */
function containsRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  return hay.some((_, i) => needle.every((n, j) => hay[i + j] === n));
}

/**
 * Suggest a discipline name for a title.
 *
 * `known` — the workspace's existing discipline names — always wins, so an org
 * that already calls it "Software Engineering" doesn't get a second, near-
 * duplicate "Engineering" created beside it. Longest known name is tried first
 * so "Data Engineering" beats "Engineering".
 *
 * Returns null when nothing matches: an empty discipline is honest, and a
 * wrong one poisons the very analytics this exists to enable.
 */
export function suggestDiscipline(title?: string | null, known: string[] = []): string | null {
  const raw = (title ?? "").trim();
  if (!raw) return null;
  const hay = normTitle(raw);

  const titleTokens = stemTokens(raw);
  const byLength = [...known].filter((k) => k.trim()).sort((a, b) => b.length - a.length);
  for (const name of byLength) {
    if (containsRun(titleTokens, stemTokens(name))) return name;
  }

  for (const rule of DISCIPLINE_RULES) {
    if (rule.keywords.some((k) => hay.includes(` ${k}`) || hay.includes(`${k} `) || hay.trim() === k)) {
      // Prefer the workspace's own casing/name if it already has this concept.
      const existing = known.find((k) => k.toLowerCase() === rule.discipline.toLowerCase());
      return existing ?? rule.discipline;
    }
  }
  return null;
}

/**
 * What a title→discipline pass would do, for the wizard's preview. The user
 * sees the counts and the misses before committing, rather than discovering
 * an invented taxonomy after the fact.
 */
export type DisciplineSuggestionPreview = {
  matched: number;
  unmatched: number;
  /** Suggested name → how many people, most populous first. */
  byDiscipline: { name: string; count: number; isNew: boolean }[];
  /** A few titles nothing matched, so the user can judge the miss rate. */
  sampleMisses: string[];
};

export function previewDisciplineSuggestions(
  titles: (string | null | undefined)[],
  known: string[] = [],
): DisciplineSuggestionPreview {
  const counts = new Map<string, number>();
  const misses: string[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const t of titles) {
    const s = suggestDiscipline(t, known);
    if (s) {
      matched++;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    } else {
      unmatched++;
      const label = (t ?? "").trim();
      if (label && misses.length < 5 && !misses.includes(label)) misses.push(label);
    }
  }

  const knownLower = new Set(known.map((k) => k.toLowerCase()));
  return {
    matched,
    unmatched,
    byDiscipline: [...counts.entries()]
      .map(([name, count]) => ({ name, count, isNew: !knownLower.has(name.toLowerCase()) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    sampleMisses: misses,
  };
}
