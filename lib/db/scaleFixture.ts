import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { Person, OrgUnit, Assignment, Discipline } from "./schema";

/**
 * Synthetic "scale" org — the fixture ROADMAP's "Scale — a real target" asks
 * for: ~90 teams / ~1,000 people, to stress-test the ghost-seat model (every
 * cross-cutting person renders a seat in EACH team they serve) at something
 * closer to a real customer's size than the 45-person demo org.
 *
 * `buildSyntheticOrg` is a pure generator (no DB) so it can be reused by both
 * this file's CLI seeder AND lib/canvas/__tests__/scale.bench.mts, which
 * benchmarks buildCanvasMap/computeAllFindings against the same shapes
 * without touching Postgres at all.
 *
 * CLI: `npm run db:scale` (== `tsx lib/db/scaleFixture.ts`), or override via
 * env (SCALE_TEAMS / SCALE_PEOPLE / SCALE_STREAMS / SCALE_SEED) or CLI flags
 * (--teams=90 --people=1000 --streams=9 --seed=1).
 *
 * Writes into its own workspace ("Scale Fixture (synthetic)", owned by
 * "scale-fixture-user") — it never touches the dev-user demo workspace that
 * `npm run db:seed` owns. Idempotent: re-running clears and rebuilds just
 * that workspace's org data.
 */

export const SCALE_OWNER = "scale-fixture-user";
export const SCALE_WORKSPACE_NAME = "Scale Fixture (synthetic)";

export type ScaleFixtureOptions = {
  /** Total teams (kind="team" leaf units). Default 90. */
  teams?: number;
  /** Total people. Default 1000. */
  people?: number;
  /** Value streams (top-level groups under the root). Default 9. */
  streams?: number;
  /** Fraction of people who are cross-cutting (2-4 team assignments). Default 0.18. */
  crossCutFraction?: number;
  /** Of the cross-cutting tail, fraction whose secondary team(s) land in a
   *  *different* stream than their home — the expensive "indigo" tier. Default 0.3. */
  crossStreamFraction?: number;
  /** Deterministic RNG seed; omit for a fresh random org each run. */
  seed?: number;
};

export type SyntheticOrg = {
  disciplines: Discipline[];
  units: OrgUnit[];
  people: Person[];
  assignments: Assignment[];
};

const RESOLVED_DEFAULTS: Required<ScaleFixtureOptions> = {
  teams: 90,
  people: 1000,
  streams: 9,
  crossCutFraction: 0.18,
  crossStreamFraction: 0.3,
  seed: Date.now() & 0xffffffff,
};

// --- small deterministic RNG (mulberry32) so a given seed reproduces --------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Dana", "Robin",
  "Priya", "Wei", "Fatima", "Diego", "Nia", "Omar", "Elena", "Kenji", "Ines", "Lukas",
  "Chidi", "Sofia", "Hana", "Mateo", "Zara", "Aiden", "Noor", "Yuki", "Leila", "Marco",
];
const LAST_NAMES = [
  "Reeve", "Bradford", "Chen", "Osei", "Nakamura", "Kowalski", "Bianchi", "Fernandez", "Kaur",
  "Novak", "Silva", "Petrov", "Haddad", "Larsen", "Okafor", "Rossi", "Ibrahim", "Solis",
  "Meyer", "Park", "Duarte", "Weber", "Costa", "Tanaka", "Adeyemi", "Vance", "Iqbal", "Moreau",
];
const TITLES = [
  "Software Engineer", "Senior Engineer", "Staff Engineer", "QA Engineer", "SRE",
  "Product Manager", "Delivery Lead", "Engineering Manager", "Data Engineer", "Security Engineer",
  "Platform Engineer", "Designer", "Agile Coach", "Solutions Architect", "Support Engineer",
];
const DISCIPLINE_DEFS: { name: string; color: string }[] = [
  { name: "Engineering", color: "#4f46e5" },
  { name: "QA", color: "#0e7490" },
  { name: "Platform", color: "#15803d" },
  { name: "Security", color: "#9d174d" },
  { name: "Data", color: "#a16207" },
  { name: "Delivery", color: "#7c3aed" },
  { name: "Design", color: "#be185d" },
  { name: "Leadership", color: "#5c6570" },
];
const EMPLOYMENTS: Person["employment"][] = ["fte", "fte", "fte", "fte", "contractor", "vendor", "unknown"];
const LOCATIONS: { location: string; timezone: string }[] = [
  { location: "Austin, TX", timezone: "America/Chicago" },
  { location: "New York, NY", timezone: "America/New_York" },
  { location: "San Francisco, CA", timezone: "America/Los_Angeles" },
  { location: "London, UK", timezone: "Europe/London" },
  { location: "Berlin, Germany", timezone: "Europe/Berlin" },
  { location: "Warsaw, Poland", timezone: "Europe/Warsaw" },
  { location: "Bengaluru, India", timezone: "Asia/Kolkata" },
  { location: "Manila, Philippines", timezone: "Asia/Manila" },
  { location: "Tokyo, Japan", timezone: "Asia/Tokyo" },
  { location: "São Paulo, Brazil", timezone: "America/Sao_Paulo" },
  { location: "Toronto, Canada", timezone: "America/Toronto" },
  { location: "Sydney, Australia", timezone: "Australia/Sydney" },
];
const STREAM_NAME_POOL = [
  "Atlas", "Orion", "Vega", "Helix", "Meridian", "Zephyr", "Cascade", "Anchor", "Beacon",
  "Compass", "Nimbus", "Lumen",
];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function nowDate(): Date {
  return new Date();
}

/** Pure generator — no DB. Same rows this file's CLI inserts, and what
 *  lib/canvas/__tests__/scale.bench.mts benchmarks directly. */
export function buildSyntheticOrg(workspaceId: string, opts?: ScaleFixtureOptions): SyntheticOrg {
  const o = { ...RESOLVED_DEFAULTS, ...opts };
  const rng = mulberry32(o.seed);
  const now = nowDate();

  // --- disciplines -----------------------------------------------------------
  const disciplines: Discipline[] = DISCIPLINE_DEFS.map((d, i) => ({
    id: randomUUID(),
    workspaceId,
    name: d.name,
    color: d.color,
    sortOrder: i,
    createdAt: now,
  }));

  // --- tree: root -> "Delivery Group" -> N streams -> teams ------------------
  const units: OrgUnit[] = [];
  const rootId = randomUUID();
  units.push({
    id: rootId,
    workspaceId,
    parentId: null,
    name: "Root",
    kind: "group",
    leadPersonId: null,
    targetHeadcount: null,
    isExternal: false,
    vendorName: null,
    costPerMonth: null,
    expectedRoi: null,
    createdAt: now,
    updatedAt: now,
  });
  const deliveryGroupId = randomUUID();
  units.push({
    id: deliveryGroupId,
    workspaceId,
    parentId: rootId,
    name: "Delivery Group",
    kind: "group",
    leadPersonId: null,
    targetHeadcount: null,
    isExternal: false,
    vendorName: null,
    costPerMonth: null,
    expectedRoi: null,
    createdAt: now,
    updatedAt: now,
  });

  const streamCount = Math.max(1, o.streams);
  const streamIds: string[] = [];
  const streamNames: string[] = [];
  for (let i = 0; i < streamCount; i++) {
    const id = randomUUID();
    const name = STREAM_NAME_POOL[i % STREAM_NAME_POOL.length] + (i >= STREAM_NAME_POOL.length ? ` ${Math.floor(i / STREAM_NAME_POOL.length) + 1}` : "");
    streamIds.push(id);
    streamNames.push(name);
    units.push({
      id,
      workspaceId,
      parentId: deliveryGroupId,
      name,
      kind: "group",
      leadPersonId: null,
      targetHeadcount: null,
      isExternal: false,
      vendorName: null,
      costPerMonth: null,
      expectedRoi: String(Math.round(rng() * 400 - 100) * 1000),
      createdAt: now,
      updatedAt: now,
    });
  }

  // Distribute teams across streams round-robin (± a little jitter) so no
  // stream is empty and sizes are realistically uneven.
  const teamCount = Math.max(streamCount, o.teams);
  const teamStreamIdx: number[] = [];
  for (let i = 0; i < teamCount; i++) teamStreamIdx.push(i % streamCount);
  // shuffle slightly so it's not perfectly round-robin
  for (let i = teamStreamIdx.length - 1; i > 0; i--) {
    if (rng() < 0.3) {
      const j = Math.floor(rng() * (i + 1));
      [teamStreamIdx[i], teamStreamIdx[j]] = [teamStreamIdx[j], teamStreamIdx[i]];
    }
  }

  const teamIds: string[] = [];
  const teamStreamOf: string[] = []; // parallel: streamId per team index
  const teamTargets: number[] = [];
  for (let i = 0; i < teamCount; i++) {
    const id = randomUUID();
    const streamIdx = teamStreamIdx[i];
    const target = 6 + Math.floor(rng() * 12); // 6-17 people target
    teamIds.push(id);
    teamStreamOf.push(streamIds[streamIdx]);
    teamTargets.push(target);
    units.push({
      id,
      workspaceId,
      parentId: streamIds[streamIdx],
      name: `${streamNames[streamIdx]} Team ${i + 1}`,
      kind: "team",
      leadPersonId: null, // wired after people exist
      targetHeadcount: target,
      isExternal: rng() < 0.08,
      vendorName: rng() < 0.08 ? "Contracted Partner LLC" : null,
      costPerMonth: String(Math.round((30000 + rng() * 120000) * 100) / 100),
      expectedRoi: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- people ------------------------------------------------------------
  const totalPeople = o.people;
  const people: Person[] = [];
  for (let i = 0; i < totalPeople; i++) {
    const disc = pick(rng, disciplines);
    const loc = pick(rng, LOCATIONS);
    const employment = pick(rng, EMPLOYMENTS);
    const tenureDays = Math.floor(rng() * 365 * 6);
    const start = new Date(now.getTime() - tenureDays * 86400000);
    const staleVacationDays = Math.floor(rng() * 500);
    people.push({
      id: randomUUID(),
      workspaceId,
      name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
      title: pick(rng, TITLES),
      managerId: null, // wired below
      startDate: start.toISOString().slice(0, 10),
      costPerMonth: String(Math.round((6000 + rng() * 15000) * 100) / 100),
      skills: [],
      growthFocus: null,
      photoUrl: null,
      lastVacationAt: new Date(now.getTime() - staleVacationDays * 86400000).toISOString().slice(0, 10),
      disciplineId: disc.id,
      employment,
      location: loc.location,
      timezone: loc.timezone,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- assignments ---------------------------------------------------------
  // Every person gets a "home" team (majority allocation, >=60%). A tail is
  // additionally cross-cutting (2-4 total team assignments); a slice of that
  // tail spans streams (the expensive indigo tier).
  const assignments: Assignment[] = [];
  const crossCutCount = Math.round(totalPeople * o.crossCutFraction);
  const crossCutIdx = new Set<number>();
  while (crossCutIdx.size < crossCutCount && crossCutIdx.size < totalPeople) {
    crossCutIdx.add(Math.floor(rng() * totalPeople));
  }

  // Weighted-random home team pick, biased by each team's target headcount so
  // sizes stay roughly proportionate rather than perfectly uniform.
  const teamWeights = teamTargets.map((t) => t);
  const totalWeight = teamWeights.reduce((a, b) => a + b, 0);
  const pickTeamIdx = (excludeIdx?: number, sameStreamAs?: string, differentStreamFrom?: string): number => {
    for (let attempt = 0; attempt < 50; attempt++) {
      let r = rng() * totalWeight;
      let idx = 0;
      for (; idx < teamWeights.length; idx++) {
        r -= teamWeights[idx];
        if (r <= 0) break;
      }
      idx = Math.min(idx, teamWeights.length - 1);
      if (idx === excludeIdx) continue;
      if (sameStreamAs && teamStreamOf[idx] !== sameStreamAs) continue;
      if (differentStreamFrom && teamStreamOf[idx] === differentStreamFrom) continue;
      return idx;
    }
    return excludeIdx != null ? (excludeIdx + 1) % teamCount : 0;
  };

  const leadPersonByTeam = new Map<number, string>(); // teamIdx -> personId, first assigned becomes lead

  for (let i = 0; i < totalPeople; i++) {
    const person = people[i];
    const homeIdx = pickTeamIdx();
    const isCrossCutter = crossCutIdx.has(i);
    const homeStream = teamStreamOf[homeIdx];

    if (!isCrossCutter) {
      // Single-team person: home = 100%, unambiguous.
      assignments.push({
        id: randomUUID(),
        workspaceId,
        personId: person.id,
        orgUnitId: teamIds[homeIdx],
        roleOnTeam: "Team Member",
        allocationPct: 100,
        isOpenRole: false,
        createdAt: now,
      });
      if (!leadPersonByTeam.has(homeIdx)) leadPersonByTeam.set(homeIdx, person.id);
      continue;
    }

    // Cross-cutting person: buildCanvasMap's "home" is whichever team holds
    // >=60% (HOME_THRESHOLD_PCT); the ghost-seat/Cross-cutting-bucket path
    // only engages when NO single team reaches that majority (see
    // lib/canvas/buildCanvasMap.ts homeOf). So a genuine cross-cutter's
    // allocations must be split with no team at or above 60%, matching how
    // the demo org's supporters are modelled (lib/data/demoOrg.ts, e.g.
    // Marcus Webb 40/40/40).
    const extraTeams = 1 + Math.floor(rng() * 3); // 1-3 more teams (2-4 total)
    const isCrossStream = rng() < o.crossStreamFraction;
    const teamIdxs = [homeIdx];
    const usedIdx = new Set([homeIdx]);
    for (let e = 0; e < extraTeams; e++) {
      let secondaryIdx: number;
      if (isCrossStream && e === 0) {
        secondaryIdx = pickTeamIdx(homeIdx, undefined, homeStream);
      } else {
        secondaryIdx = pickTeamIdx(homeIdx, undefined, undefined);
      }
      if (usedIdx.has(secondaryIdx)) continue;
      usedIdx.add(secondaryIdx);
      teamIdxs.push(secondaryIdx);
    }
    // Split allocation across all of this person's teams, capped so the
    // largest share stays under 60%.
    const n = teamIdxs.length;
    const base = Math.floor(100 / n);
    const cap = 55;
    let remaining = 100;
    teamIdxs.forEach((idx, i) => {
      const isLast = i === teamIdxs.length - 1;
      const jitter = isLast ? 0 : Math.floor(rng() * 10) - 5;
      const pct = isLast
        ? Math.max(10, Math.min(cap, remaining))
        : Math.max(10, Math.min(cap, base + jitter, remaining - 10 * (teamIdxs.length - i - 1)));
      remaining -= pct;
      assignments.push({
        id: randomUUID(),
        workspaceId,
        personId: person.id,
        orgUnitId: teamIds[idx],
        roleOnTeam: i === 0 ? "Team Member" : "Supporting",
        allocationPct: pct,
        isOpenRole: false,
        createdAt: now,
      });
      if (!leadPersonByTeam.has(idx)) leadPersonByTeam.set(idx, person.id);
    });
  }

  // Wire team leads (first person assigned to that team) + a light manager
  // chain (team members report to their team's lead).
  for (const [teamIdx, leadId] of leadPersonByTeam) {
    const unit = units.find((u) => u.id === teamIds[teamIdx]);
    if (unit) unit.leadPersonId = leadId;
  }
  const personById = new Map(people.map((p) => [p.id, p]));
  const homeTeamOfPerson = new Map<string, number>();
  for (const a of assignments) {
    if (a.allocationPct != null && a.allocationPct >= 60 && a.personId) {
      homeTeamOfPerson.set(a.personId, teamIds.indexOf(a.orgUnitId));
    }
  }
  for (const p of people) {
    const teamIdx = homeTeamOfPerson.get(p.id);
    if (teamIdx == null) continue;
    const leadId = leadPersonByTeam.get(teamIdx);
    if (leadId && leadId !== p.id) {
      const person = personById.get(p.id)!;
      person.managerId = leadId;
    }
  }

  // A handful of open roles so staffing-gap analytics has something too.
  for (let i = 0; i < Math.round(teamCount * 0.3); i++) {
    const idx = Math.floor(rng() * teamCount);
    assignments.push({
      id: randomUUID(),
      workspaceId,
      personId: null,
      orgUnitId: teamIds[idx],
      roleOnTeam: "Open Requisition",
      allocationPct: 100,
      isOpenRole: true,
      createdAt: now,
    });
  }

  return { disciplines, units, people, assignments };
}

// --- CLI ---------------------------------------------------------------
function parseArgs(): ScaleFixtureOptions {
  const argv = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z]+)=(.+)$/);
    if (m) flags[m[1]] = m[2];
  }
  const num = (flagName: string, envName: string): number | undefined => {
    const v = flags[flagName] ?? process.env[envName];
    return v != null ? Number(v) : undefined;
  };
  // Only include keys that were actually set — `{...defaults, ...opts}` would
  // otherwise overwrite a default with an explicit `undefined` property.
  const raw: ScaleFixtureOptions = {
    teams: num("teams", "SCALE_TEAMS"),
    people: num("people", "SCALE_PEOPLE"),
    streams: num("streams", "SCALE_STREAMS"),
    crossCutFraction: num("crossCut", "SCALE_CROSS_CUT_FRACTION"),
    crossStreamFraction: num("crossStream", "SCALE_CROSS_STREAM_FRACTION"),
    seed: num("seed", "SCALE_SEED"),
  };
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  ) as ScaleFixtureOptions;
}

async function insertInChunks<T extends Record<string, unknown>>(
  db: PostgresJsDatabase<typeof schema>,
  table: Parameters<PostgresJsDatabase<typeof schema>["insert"]>[0],
  rows: T[],
  chunkSize = 500,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table as any).values(chunk as any);
  }
}

async function main() {
  const opts = parseArgs();
  const resolved = { ...RESOLVED_DEFAULTS, ...opts };
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });
  const { workspaces, memberships, people, orgUnits, assignments, disciplines } = schema;

  let ws = (
    await db.select().from(workspaces).where(eq(workspaces.ownerUserId, SCALE_OWNER)).limit(1)
  )[0];
  if (!ws) {
    ws = (
      await db.insert(workspaces).values({ name: SCALE_WORKSPACE_NAME, ownerUserId: SCALE_OWNER }).returning()
    )[0];
    await db
      .insert(memberships)
      .values({ workspaceId: ws.id, userId: SCALE_OWNER, role: "owner" })
      .onConflictDoNothing();
  }
  const wid = ws.id;

  console.log(`Generating synthetic org: ${resolved.people} people / ${resolved.teams} teams / ${resolved.streams} streams (seed=${resolved.seed})`);
  const org = buildSyntheticOrg(wid, resolved);

  // Clear this workspace's org data only — never touches dev-user's demo org.
  await db.delete(assignments).where(eq(assignments.workspaceId, wid));
  await db.delete(orgUnits).where(eq(orgUnits.workspaceId, wid));
  await db.delete(people).where(eq(people.workspaceId, wid));
  await db.delete(disciplines).where(eq(disciplines.workspaceId, wid));

  await insertInChunks(db, disciplines, org.disciplines);
  // People before units: org_units.leadPersonId references people.id, so
  // people must exist first. (Units' own parentId self-reference and
  // people's own managerId self-reference are each fine within one chunk —
  // Postgres checks FK constraints at end-of-statement, not per-row.)
  await insertInChunks(db, people, org.people, 500);
  // Units must be inserted in an order where parents precede children — the
  // generator already builds them root-first, so a straight chunked insert
  // works (chunks stay within a single insert, but rows are still ordered).
  await insertInChunks(db, orgUnits, org.units, 500);
  await insertInChunks(db, assignments, org.assignments, 500);

  console.log(`Seeded workspace ${wid} ("${SCALE_WORKSPACE_NAME}"):`, {
    disciplines: org.disciplines.length,
    units: org.units.length,
    people: org.people.length,
    assignments: org.assignments.length,
  });
  await sql.end();
}

import { fileURLToPath } from "url";
const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
