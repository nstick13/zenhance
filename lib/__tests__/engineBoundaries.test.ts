/**
 * The six engines keep to their lanes (Greg, 2026-09-24).
 *
 * `docs/ENGINES.md` names six engines and one rule: dependencies run
 *
 *     layout  →  camera  →  runtime  →  { growth, basket, signal, work }
 *
 * An engine may import from anything to its left, never to its right, and
 * never from a sibling inside the braces. When two siblings need the same
 * fact, that fact belongs further left.
 *
 * This test is that rule. It exists because the rule is worth nothing if it
 * lives only in a document — several agents commit to this repo in parallel
 * and none of them can see each other's chats. Here, a bad import fails in
 * three seconds with a message saying exactly which line broke which rule.
 *
 * Adding a file? Put it in ENGINE_OF below. An unassigned file under a
 * watched directory fails the test on purpose: deciding which engine owns a
 * new file is the point, not a formality.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** Left to right. A tier may import its own tier and anything lower. */
const TIER = { data: 0, layout: 1, camera: 2, runtime: 3, engine: 4 } as const;
type Engine =
  | "layout" | "camera" | "runtime"
  | "growth" | "basket" | "signal" | "work";

const TIER_OF: Record<Engine, number> = {
  layout: TIER.layout,
  camera: TIER.camera,
  runtime: TIER.runtime,
  growth: TIER.engine,
  basket: TIER.engine,
  signal: TIER.engine,
  work: TIER.engine,
};

/**
 * Which engine owns which file. Paths are repo-relative and exact — a glob
 * would quietly adopt new files, and adopting a file without thinking is the
 * failure mode this test is here to prevent.
 */
const ENGINE_OF: Record<string, Engine> = {
  // 1. Layout — where every node sits.
  "lib/orbital/geometry.ts": "layout",
  "lib/orbital/layout.ts": "layout",
  "lib/orbital/branches.ts": "layout",
  "lib/orbital/complexity.ts": "layout",
  "lib/orbital/forest.ts": "layout",
  "lib/orbital/position.ts": "layout",
  "lib/orbital/envelope.ts": "layout",
  "lib/orbital/size.ts": "layout",
  "lib/orbital/model.ts": "layout",
  "lib/orbital/snap.ts": "layout",

  // 5. Camera — pan, zoom, focus, and how closely you are looking.
  "lib/orbital/focus.ts": "camera",
  "lib/orbital/lod.ts": "camera",
  "lib/orbital/detail.ts": "camera",
  "lib/map/camera/viewport.ts": "camera",
  "lib/map/camera/focusStack.ts": "camera",

  // 0. Runtime — the floor the engines stand on.
  "lib/orbital/motion.ts": "runtime",
  "lib/orbital/visibility.ts": "runtime",
  "lib/orbital/avatar.ts": "runtime",

  // 2. Growth — add, merge, re-parent.
  "lib/map/growth/insertion.ts": "growth",
  "lib/map/growth/relationship.ts": "growth",
  "lib/map/growth/drop.ts": "growth",

  // 6. Basket — carrying a node a long way.
  "lib/map/basket/basket.ts": "basket",
  "lib/map/basket/tray.ts": "basket",

  // 3. Work — how work reads at a human level.
  "lib/map/work/board.ts": "work",

  // 4. Signal — what a node is telling you.
  "lib/map/signal/progress.ts": "signal",
  "lib/map/signal/rings.ts": "signal",
};

/** Everything below the engines. Any engine may import these. */
const DATA_PREFIXES = [
  "lib/db/", "lib/data/", "lib/mock/", "lib/auth/", "lib/analytics/",
  "lib/canvas/", "lib/org/",
];
const DATA_FILES = ["lib/vocabulary.ts", "lib/validation.ts", "lib/theme.ts"];

/** Directories every file of which must be assigned an engine. */
const WATCHED = ["lib/orbital", "lib/map"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (entry === "__tests__" || entry.startsWith(".")) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Resolve an import specifier to a repo-relative path, or null if external. */
function resolve(from: string, spec: string): string | null {
  let rel: string;
  if (spec.startsWith("@/")) rel = spec.slice(2);
  else if (spec.startsWith(".")) {
    const dir = from.slice(0, from.lastIndexOf("/"));
    rel = relative(ROOT, join(ROOT, dir, spec));
  } else return null; // node_modules
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    try {
      if (statSync(join(ROOT, rel + ext)).isFile()) return rel + ext;
    } catch { /* keep trying */ }
  }
  return null;
}

function importsOf(file: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  readFileSync(join(ROOT, file), "utf8").split("\n").forEach((text, i) => {
    const m = text.match(/(?:from|import)\s+["']([^"']+)["']/);
    if (m) out.push({ spec: m[1], line: i + 1 });
  });
  return out;
}

const tierOfPath = (p: string): number | null => {
  if (ENGINE_OF[p]) return TIER_OF[ENGINE_OF[p]];
  if (DATA_FILES.includes(p) || DATA_PREFIXES.some((d) => p.startsWith(d))) return TIER.data;
  return null;
};

describe("engine boundaries (docs/ENGINES.md)", () => {
  it("assigns every watched file to an engine", () => {
    const unassigned = WATCHED.flatMap(sourceFiles).filter((f) => !ENGINE_OF[f]);
    expect(
      unassigned,
      `Unassigned file(s). Decide which engine owns them and add them to ` +
        `ENGINE_OF in this test, and to the matching section of docs/ENGINES.md:\n  ` +
        unassigned.join("\n  "),
    ).toEqual([]);
  });

  it("never imports rightward, and never from a sibling engine", () => {
    const broken: string[] = [];

    for (const [file, engine] of Object.entries(ENGINE_OF)) {
      const mine = TIER_OF[engine];
      for (const { spec, line } of importsOf(file)) {
        const target = resolve(file, spec);
        if (!target) continue;
        const theirs = tierOfPath(target);
        if (theirs === null) continue;

        if (theirs > mine) {
          broken.push(
            `${file}:${line} — ${engine} imports ${ENGINE_OF[target]} (${spec}). ` +
              `Dependencies run left to right only.`,
          );
        } else if (theirs === mine && mine === TIER.engine && ENGINE_OF[target] !== engine) {
          broken.push(
            `${file}:${line} — ${engine} imports sibling engine ` +
              `${ENGINE_OF[target]} (${spec}). Siblings must not know about each ` +
              `other; move the shared fact left into layout, camera or runtime.`,
          );
        }
      }
    }

    expect(broken, `\n${broken.join("\n")}\n`).toEqual([]);
  });

  it("keeps React and Konva out of the pure layer", () => {
    const leaked: string[] = [];
    for (const file of Object.keys(ENGINE_OF)) {
      for (const { spec, line } of importsOf(file)) {
        if (/^(react|react-dom|react-konva|konva)(\/|$)/.test(spec)) {
          leaked.push(`${file}:${line} — imports ${spec}`);
        }
      }
    }
    expect(
      leaked,
      `The pure layer must be drivable with no React and no Konva — that is ` +
        `what makes it testable:\n${leaked.join("\n")}\n`,
    ).toEqual([]);
  });
});
