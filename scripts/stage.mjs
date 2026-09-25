#!/usr/bin/env node
/**
 * Run a stage on its own port, so two of them can be compared side by side.
 *
 * Greg, 2026-09-25: *"I should be able to compare different versions by
 * running them on different local servers."* Two windows, two ports, the same
 * company on each — which is the only honest way to judge whether one version
 * of an engine feels better than another.
 *
 *   npm run stage             list what is checked out, and what is unsaved
 *   npm run stage lab         run `lab` on its port (creating the checkout)
 *   npm run stage:clean       remove the extra checkouts again
 *
 * Each stage gets a **git worktree**: a second working copy of this repo on a
 * different branch, sharing one history. Not a clone — the git objects are
 * shared, so only the working files and `node_modules` are duplicated.
 *
 * ## Why this script exists rather than "just use git worktree"
 *
 * On 2026-09-24 this repo had three worktrees nobody remembered, holding 46
 * uncommitted files between them — invisible to every other agent, because a
 * worktree is somebody's private corner unless something makes it public.
 * One held a dev server on :3000 quietly serving a build three weeks stale.
 *
 * So: checkouts live in predictable sibling directories rather than in a temp
 * folder or somebody's tool cache, `npm run stage` shows unsaved work in all
 * of them at once, and cleaning up refuses to throw any of it away.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARENT = dirname(REPO);

/** One port each, fixed, so a bookmark keeps working and two stages never
 *  collide. 3000 is deliberately left free for whatever you are working on. */
const STAGES = {
  lab: { port: 3001, blurb: "wild west — trying an idea" },
  next: { port: 3002, blurb: "the trunk — built for real" },
  release: { port: 3003, blurb: "last stop before live" },
  main: { port: 3004, blurb: "production — look, don't touch" },
};

const git = (args, cwd = REPO) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const pathFor = (stage) => join(PARENT, `zenhance-${stage}`);

/** Worktrees git knows about, as { branch → path }. */
function checkouts() {
  const out = {};
  let path = null;
  for (const line of git(["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    if (line.startsWith("branch ")) out[line.slice(7).replace("refs/heads/", "")] = path;
  }
  return out;
}

const unsavedIn = (path) =>
  existsSync(path) ? git(["status", "--porcelain"], path).split("\n").filter(Boolean).length : 0;

function list() {
  const live = checkouts();
  console.log("\n  stage     port  checked out                      unsaved");
  console.log("  ─────────────────────────────────────────────────────────");
  let anyUnsaved = false;
  for (const [stage, { port, blurb }] of Object.entries(STAGES)) {
    const path = live[stage];
    const unsaved = path ? unsavedIn(path) : 0;
    if (unsaved) anyUnsaved = true;
    const where = path === REPO ? "this folder" : path ? path.replace(PARENT + "/", "") : "—";
    console.log(
      `  ${stage.padEnd(9)} ${String(port).padEnd(5)} ${where.padEnd(32)} ` +
      (unsaved ? `${unsaved} file${unsaved === 1 ? "" : "s"} ⚠` : path ? "clean" : ""),
    );
  }
  console.log(`\n  ${Object.entries(STAGES).map(([s, v]) => `${s} :${v.port}`).join("  ·  ")}`);
  for (const [stage, { blurb }] of Object.entries(STAGES)) {
    console.log(`    ${stage.padEnd(9)} ${blurb}`);
  }
  if (anyUnsaved) {
    console.log(
      "\n  ⚠ Unsaved work above is invisible to every other agent until it is\n" +
      "    committed and pushed. See AGENTS.md — this has bitten us before.",
    );
  }
  console.log("\n  npm run stage <name>   run one   ·   npm run stage:clean   tidy up\n");
}

/**
 * Point a checkout at the same local environment as this one.
 *
 * `.env` and `.env.local` are gitignored, so a fresh worktree has no
 * DATABASE_URL and every page that touches data returns 500. Symlinked rather
 * than copied on purpose: every stage then reads the *same* local database,
 * which is exactly what comparing two versions needs — same company, same
 * data, different code — and there is only one file to edit.
 */
function linkEnv(path) {
  if (path === REPO) return;
  for (const name of [".env", ".env.local"]) {
    const source = join(REPO, name);
    const target = join(path, name);
    if (!existsSync(source)) continue;
    try { unlinkSync(target); } catch { /* wasn't there */ }
    symlinkSync(source, target);
    console.log(`  linked ${name} → this checkout's`);
  }
}

function run(stage) {
  const { port } = STAGES[stage];
  let path = checkouts()[stage];

  if (path === REPO) {
    console.log(`\n  '${stage}' is checked out in this folder — running it here on :${port}.\n`);
  } else if (!path) {
    path = pathFor(stage);
    console.log(`\n  Creating a checkout of '${stage}' at ${path}`);
    git(["fetch", "origin", "--quiet"]);
    git(["worktree", "add", path, stage]);
  } else {
    console.log(`\n  Using the existing checkout at ${path}`);
  }

  linkEnv(path);

  if (!existsSync(join(path, "node_modules"))) {
    console.log("  Installing dependencies (a few minutes, and about 600MB)…\n");
    // `ci`, not `install`: it installs exactly what the lockfile says and
    // never rewrites it. `install` quietly syncs the lockfile's version field
    // to package.json, which leaves every checkout showing a modified file
    // forever — and an edit nobody made is an edit somebody eventually
    // commits by accident.
    try {
      execFileSync("npm", ["ci"], { cwd: path, stdio: "inherit" });
    } catch {
      console.log("\n  `npm ci` failed (lockfile out of step?) — falling back to `npm install`.");
      console.log("  Check `git status` in that checkout afterwards.\n");
      execFileSync("npm", ["install"], { cwd: path, stdio: "inherit" });
    }
  }

  console.log(`\n  ${stage} → http://localhost:${port}\n`);
  spawn("npx", ["next", "dev", "--port", String(port)], {
    cwd: path,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) },
  }).on("exit", (code) => process.exit(code ?? 0));
}

function clean() {
  const live = checkouts();
  let removed = 0, kept = 0;
  for (const [stage] of Object.entries(STAGES)) {
    const path = live[stage];
    if (!path || path === REPO) continue;
    const unsaved = unsavedIn(path);
    if (unsaved > 0) {
      kept += 1;
      console.log(
        `  keeping  ${stage} — ${unsaved} unsaved file${unsaved === 1 ? "" : "s"} at ${path}\n` +
        `           commit or discard them first; this script will not decide for you`,
      );
      continue;
    }
    git(["worktree", "remove", path]);
    removed += 1;
    console.log(`  removed  ${stage} (${path})`);
  }
  git(["worktree", "prune"]);
  if (removed === 0 && kept === 0) console.log("  nothing to clean up");
  console.log("");
}

const arg = process.argv[2];
if (!arg) list();
else if (arg === "--clean") clean();
else if (STAGES[arg]) run(arg);
else {
  console.error(`\n  Unknown stage '${arg}'. One of: ${Object.keys(STAGES).join(", ")}\n`);
  process.exit(1);
}
