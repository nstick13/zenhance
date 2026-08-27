/**
 * Scale check for docs/ROADMAP.md "Scale — a real target": the ghost-seat
 * model multiplies node count (every cross-cutting person renders a seat in
 * EACH team they serve), and it was untested past the 45-person demo org.
 * This benchmarks the pure transform (`buildCanvasMap`) and the analytics
 * pass (`computeAllFindings`) directly against in-memory synthetic snapshots
 * — no DB involved, so it's fast and deterministic (fixed seed).
 *
 * Ghost seat count is reproduced from the same derivation OrgCanvas.tsx's
 * `ghostSeats` memo uses (components/viz/OrgCanvas.tsx ~473-487): one ghost
 * seat per (cross-cutting person, allocation) pair — i.e. every CanvasPerson
 * with `crossCuttingTier !== null`, summed over `allocations.length`.
 *
 * Run: npx tsx lib/canvas/__tests__/scale.bench.mts
 */
import { buildCanvasMap, type CanvasMapData } from "../buildCanvasMap";
import { buildSyntheticOrg } from "../../db/scaleFixture";
import { computeAllFindings } from "../../analytics/findings";
import type { Snapshot } from "../../org/model";

type Scenario = { label: string; people: number; teams: number; streams: number };

const SCENARIOS: Scenario[] = [
  { label: "45 people (today's demo scale)", people: 45, teams: 7, streams: 3 },
  { label: "1,000 people / 90 teams (the ROADMAP target)", people: 1000, teams: 90, streams: 9 },
  { label: "2,000 people / 180 teams (one step beyond)", people: 2000, teams: 180, streams: 10 },
];

const SEED = 42;
const WARMUP_RUNS = 3;
const TIMED_RUNS = 7;

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Reproduces OrgCanvas.tsx's `ghostSeats` memo derivation over map output:
 *  one ghost seat per (cross-cutting person, allocation) pair. */
function countGhostSeats(map: CanvasMapData): number {
  let count = 0;
  for (const n of map.nodes) {
    if (n.kind !== "person") continue;
    if (n.crossCuttingTier === null) continue;
    count += n.allocations.length;
  }
  return count;
}

function timeMs(fn: () => void): number[] {
  const samples: number[] = [];
  for (let i = 0; i < WARMUP_RUNS; i++) fn();
  for (let i = 0; i < TIMED_RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

type Row = {
  label: string;
  people: number;
  teams: number;
  nodes: number;
  ghostSeats: number;
  buildCanvasMapMs: number;
  findingsCount: number;
  findingsMs: number;
};

async function main() {
  const rows: Row[] = [];

  for (const scenario of SCENARIOS) {
    const workspaceId = "bench-workspace";
    const org = buildSyntheticOrg(workspaceId, {
      people: scenario.people,
      teams: scenario.teams,
      streams: scenario.streams,
      seed: SEED,
    });
    const snapshot: Snapshot = { people: org.people, units: org.units, assignments: org.assignments };
    const positions = new Map();

    let lastMap: CanvasMapData | null = null;
    const buildTimes = timeMs(() => {
      lastMap = buildCanvasMap(snapshot, positions);
    });
    const map = lastMap!;
    const ghostSeats = countGhostSeats(map);

    let lastFindings: ReturnType<typeof computeAllFindings> | null = null;
    const findingsTimes = timeMs(() => {
      lastFindings = computeAllFindings(snapshot);
    });
    const findings = lastFindings!;

    rows.push({
      label: scenario.label,
      people: scenario.people,
      teams: scenario.teams,
      nodes: map.nodes.length,
      ghostSeats,
      buildCanvasMapMs: Math.round(median(buildTimes) * 100) / 100,
      findingsCount: findings.length,
      findingsMs: Math.round(median(findingsTimes) * 100) / 100,
    });
  }

  console.log(`\nScale benchmark (seed=${SEED}, median of ${TIMED_RUNS} timed runs after ${WARMUP_RUNS} warmup runs)\n`);
  console.table(
    rows.map((r) => ({
      scenario: r.label,
      people: r.people,
      teams: r.teams,
      "canvas nodes": r.nodes,
      "ghost seats": r.ghostSeats,
      "buildCanvasMap (ms)": r.buildCanvasMapMs,
      findings: r.findingsCount,
      "findings (ms)": r.findingsMs,
    })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
