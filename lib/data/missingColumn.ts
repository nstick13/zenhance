/**
 * **A column the database has not been told about yet.**
 *
 * The order that matters when a change ships: **migration first, code
 * second.** Get it the other way round and the code asks Postgres for a
 * column that is not there, Postgres refuses the whole query, and the page
 * that ran it is an error page — for everybody, at once, until somebody
 * notices.
 *
 * It has happened here. ROADMAP records migration `0005` going out in the
 * wrong order and taking **every** page down. `0009` — the column that
 * remembers how far from its parent you dropped a node — was queued up to do
 * the same to `/org`, and sat in TASKS.md as a release blocker for weeks
 * because the only thing standing between the two was somebody remembering.
 *
 * So this is the seatbelt rather than another reminder: a query that can
 * name the columns it could do without, and carry on without them. The
 * feature degrades — a map whose saved distances are missing is a map that
 * falls back to the calculated layout, which is what a workspace that has
 * never been arranged does anyway — instead of the page falling over.
 *
 * **It is not a licence to ship in the wrong order.** The migration still has
 * to be applied, and until it is, somebody's arrangement is quietly not being
 * read back. It buys the hour it takes a human to notice, which is exactly
 * what was missing.
 *
 * `42703` is Postgres's own code for *undefined column*, so this asks the
 * database what went wrong rather than reading its prose — the message is
 * localised and the drivers word it differently.
 */
export const UNDEFINED_COLUMN = "42703";

/**
 * True when Postgres refused a query because a column does not exist.
 *
 * **It walks `cause`, and that is the whole reason it works.** Measured
 * against the real stack on 2026-11-04: ask Drizzle for a column that is not
 * there and the error it throws has `code: undefined` and a message of
 * *"Failed query: …"*. The driver's own error, with `42703` on it, is one
 * level down under `cause`. A guard that read `error.code` and stopped would
 * have been a seatbelt that quietly did nothing — and `/org` runs the same
 * driver (postgres.js) against Neon as it does against the Postgres on your
 * machine, so what is true here is true in production.
 */
export function isMissingColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const seen = new Set<unknown>();
  let at: unknown = error;
  while (at && typeof at === "object" && !seen.has(at)) {
    seen.add(at);
    if ((at as { code?: unknown }).code === UNDEFINED_COLUMN) return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}
