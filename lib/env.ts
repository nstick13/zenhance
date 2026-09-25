/**
 * Which stage is this running in, and what is it allowed to do?
 *
 * The app had no idea where it was running. `NODE_ENV` told it whether to use
 * the dev-auth bypass and nothing else, so lab experiments shipped to
 * customers and any `DATABASE_URL` that happened to be set was written to
 * without question. This is the one place that knows.
 *
 * See [docs/ENVIRONMENTS.md](../docs/ENVIRONMENTS.md) for the four stages and
 * what each one is for.
 */

/** The four stages work moves through, plus a developer's own machine. */
export type Stage = "local" | "lab" | "next" | "release" | "production";

/**
 * Branch → stage, **for previews only**.
 *
 * `main` maps to `release`, not to `production`: a preview built from `main`
 * is production-*shaped* but it is not live, and calling it production would
 * hide the lab pages on a URL nobody is meant to trust and switch on
 * behaviour that belongs only to the real thing. Production is decided by
 * `VERCEL_ENV` alone, below.
 *
 * A branch not listed is somebody's story branch, and its preview is treated
 * as `next`: safe to look at, not safe to trust.
 */
const PREVIEW_STAGE_OF_BRANCH: Record<string, Stage> = {
  lab: "lab",
  next: "next",
  release: "release",
  main: "release",
};

/**
 * Where are we?
 *
 * Vercel sets `VERCEL_ENV` to production/preview/development, and
 * `VERCEL_GIT_COMMIT_REF` to the branch. Production is production whatever
 * the branch says — that one is deliberately not inferred from a name,
 * because a name is easy to get wrong and this decides who sees what.
 */
export function stage(env: NodeJS.ProcessEnv = process.env): Stage {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") {
    return PREVIEW_STAGE_OF_BRANCH[env.VERCEL_GIT_COMMIT_REF ?? ""] ?? "next";
  }
  return "local";
}

export const isProduction = (env: NodeJS.ProcessEnv = process.env): boolean =>
  stage(env) === "production";

/**
 * Are the lab pages reachable?
 *
 * Everywhere except production. Experiments live in the codebase on every
 * branch — that is what lets anyone open a preview and *look* at one — but a
 * customer must never find a half-finished idea by guessing a URL.
 *
 * Gating beats deleting: nothing has to be stripped out before a release, so
 * nobody has to remember to strip it.
 */
export const labPagesVisible = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !isProduction(env);

/** Postgres on this machine. Anything else is somebody's real data. */
export function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Refuse to bulk-write to a database that isn't this machine's.
 *
 * Every seeder fills a workspace with invented people. Pointed at the wrong
 * database that is not a mistake you can undo — it is customer data with
 * Sparrow Jam written over it. `northwind.ts` had this guard from the start;
 * `seed`, `companies` and `scaleFixture` did not, and they are just as
 * capable of doing the damage.
 *
 * Deliberately a hard exit rather than a prompt: a seeder is usually run by
 * an agent, and an agent cannot be trusted to read a warning it did not
 * expect.
 */
export function requireLocalDatabase(what: string, url = process.env.DATABASE_URL): void {
  if (isLocalDatabase(url)) return;
  const where = (() => {
    try { return url ? new URL(url).hostname : "(DATABASE_URL not set)"; }
    catch { return "(unparseable DATABASE_URL)"; }
  })();
  console.error(
    `\nRefusing to seed: ${what} writes invented data and DATABASE_URL is not local.\n` +
    `  DATABASE_URL points at: ${where}\n\n` +
    `Seeders are development fixtures. Writing one to a hosted database\n` +
    `overwrites real people with invented ones, and there is no undo.\n\n` +
    `If you meant to reset your own machine, check .env.local.\n`,
  );
  process.exit(1);
}
