/**
 * The shape of a large company — ~2,500 people over eleven ragged rungs.
 *
 * It is the fixture every pure scale test runs on, and since 2026-09-23 it is
 * also what `lib/db/northwind.ts` seeds into the **local** development
 * database, so the company the tests prove things about and the company you
 * can open at /org are the same company. Nothing here touches a database
 * itself, and nothing seeds a hosted one: the seeder refuses any database that
 * is not on this machine.
 */
import { randomUUID } from "crypto";
import type { Assignment, Discipline, OrgUnit, Person } from "@/lib/db/schema";

/**
 * A deep, ragged org — the shape a real enterprise actually has (Greg,
 * 2026-09-14): eleven or twelve rungs below the CEO, with delivery teams
 * appearing at *different* depths. One team reports at CEO+2 because it was
 * always the founder's pet; another sits at CEO+10 behind four layers of
 * division, region and function.
 *
 * That raggedness isn't decoration — it's what makes the map legible at
 * scale. The flat generator put every team on one rung, so that rung's
 * circumference had to hold all 180 of them and the map ballooned. Spread the
 * same teams down eleven rungs and each rung holds a handful, so every level
 * stays compact and each team still gets room for its people and their work.
 *
 * Pure: no DB, no env, so the layout bench can import it too.
 */

export type DeepOrgOptions = {
  /** Roughly how many people to produce. Default 2,400. */
  people?: number;
  /** Deepest rung a unit may sit on. Default 11. */
  maxDepth?: number;
  /** Deterministic seed. */
  seed?: number;
  /** Name for the root unit. Defaults to the invented carrier's name. */
  rootName?: string;
};

export type DeepOrg = {
  disciplines: Discipline[];
  units: OrgUnit[];
  people: Person[];
  assignments: Assignment[];
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

const FIRST = ["Ana","Ben","Cara","Dev","Elin","Femi","Gus","Hana","Ivo","Jo","Kit","Lara","Mo","Nina","Omar","Pia","Quinn","Ravi","Sara","Tom","Uma","Vik","Wren","Xan","Yara","Zed","Cliff","Dara","Esme","Fred"];
const LAST = ["Adeyemi","Bauer","Castillo","Dunn","Eriksen","Ferraro","Gomez","Halder","Ito","Jansen","Kaur","Lindqvist","Moreau","Nakamura","Owusu","Petrov","Quimby","Reyes","Silva","Tanaka","Ulrich","Vogel","Walsh","Xu","Yildiz","Zhou"];
const TITLES = ["Engineer","Senior Engineer","QA Engineer","Platform Engineer","Data Engineer","Designer","Product Manager","Delivery Lead","SRE","Analyst"];
const DISCIPLINES = ["Engineering","QA","Platform","Security","Data","Delivery","Design","Operations"];

/** Names for each rung, so a unit reads as what it is. */
const GROUP_WORDS = [
  ["Group"],
  ["Division", "Sector"],
  ["Region", "Portfolio"],
  ["Business Unit", "Practice"],
  ["Function", "Chapter"],
  ["Programme", "Domain"],
  ["Area", "Cluster"],
  ["Stream", "Guild"],
];
const PROPER = ["Aurora","Beacon","Cascade","Delta","Everest","Falcon","Granite","Harbour","Iris","Juniper","Keystone","Lumen","Meridian","Nimbus","Orchid","Pioneer","Quartz","Ridge","Summit","Trident","Union","Vertex","Willow","Zephyr","Anchor","Bluff","Copper","Dune"];

export function buildDeepOrg(workspaceId: string, opts: DeepOrgOptions = {}): DeepOrg {
  const targetPeople = opts.people ?? 2400;
  const maxDepth = opts.maxDepth ?? 11;
  const rng = mulberry32(opts.seed ?? 1);
  const now = new Date();

  const disciplines: Discipline[] = DISCIPLINES.map((name, i) => ({
    id: randomUUID(),
    workspaceId,
    name,
    color: "#5c6570",
    sortOrder: i,
    createdAt: now,
    updatedAt: now,
  }));

  const units: OrgUnit[] = [];
  const teams: { unit: OrgUnit; depth: number }[] = [];

  const makeUnit = (name: string, parentId: string | null, kind: "group" | "team"): OrgUnit => ({
    id: randomUUID(),
    workspaceId,
    parentId,
    name,
    kind,
    leadPersonId: null,
    targetHeadcount: null,
    isExternal: false,
    vendorName: null,
    costPerMonth: null,
    expectedRoi: null,
    createdAt: now,
    updatedAt: now,
  });

  const root = makeUnit(opts.rootName ?? "a deep enterprise shape", null, "group");
  units.push(root);

  let peopleBudget = targetPeople;
  const usedNames = new Set<string>();
  const properName = (depth: number): string => {
    for (let i = 0; i < 40; i++) {
      const word = pick(rng, GROUP_WORDS[Math.min(depth, GROUP_WORDS.length - 1)]);
      const name = `${pick(rng, PROPER)} ${word}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    return `Unit ${units.length}`;
  };

  /**
   * Grow a subtree. A node becomes a team more readily the deeper it sits, so
   * teams surface at every rung from CEO+2 down rather than all at the bottom.
   */
  const grow = (parent: OrgUnit, depth: number) => {
    if (peopleBudget <= 0) return;
    const childCount = depth <= 1 ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
    for (let i = 0; i < childCount && peopleBudget > 0; i++) {
      // Shallow rungs almost always branch; deep ones almost always deliver.
      const teamChance = depth < 2 ? 0.06 : Math.min(0.85, 0.12 + depth * 0.09);
      const isTeam = depth >= maxDepth || rng() < teamChance;
      if (isTeam) {
        const unit = makeUnit(`${pick(rng, PROPER)} Team ${teams.length + 1}`, parent.id, "team");
        units.push(unit);
        teams.push({ unit, depth: depth + 1 });
        peopleBudget -= 5 + Math.floor(rng() * 9);
      } else {
        const unit = makeUnit(properName(depth), parent.id, "group");
        units.push(unit);
        grow(unit, depth + 1);
      }
    }
  };
  grow(root, 0);

  // --- people ---------------------------------------------------------------
  const people: Person[] = [];
  const assignments: Assignment[] = [];

  const makePerson = (): Person => {
    const started = Math.floor(rng() * 365 * 7);
    const vacation = Math.floor(rng() * 700);
    return {
      id: randomUUID(),
      workspaceId,
      name: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
      title: pick(rng, TITLES),
      managerId: null,
      startDate: new Date(now.getTime() - started * 86400000).toISOString().slice(0, 10),
      costPerMonth: String(Math.round(5000 + rng() * 12000)),
      skills: [],
      growthFocus: null,
      photoUrl: null,
      lastVacationAt: new Date(now.getTime() - vacation * 86400000).toISOString().slice(0, 10),
      disciplineId: pick(rng, disciplines).id,
      employment: rng() < 0.12 ? "contractor" : "fte",
      location: null,
      timezone: null,
      createdAt: now,
      updatedAt: now,
    };
  };

  // Every team gets its own people, the first of whom leads it.
  for (const { unit } of teams) {
    const size = 5 + Math.floor(rng() * 9);
    const members: Person[] = [];
    for (let i = 0; i < size; i++) {
      const person = makePerson();
      people.push(person);
      members.push(person);
      assignments.push({
        id: randomUUID(),
        workspaceId,
        personId: person.id,
        orgUnitId: unit.id,
        roleOnTeam: i === 0 ? "Team Lead" : person.title,
        allocationPct: 100,
        isOpenRole: false,
        createdAt: now,
      });
    }
    unit.leadPersonId = members[0].id;
    for (let i = 1; i < members.length; i++) members[i].managerId = members[0].id;
    if (rng() < 0.3) {
      assignments.push({
        id: randomUUID(),
        workspaceId,
        personId: null,
        orgUnitId: unit.id,
        roleOnTeam: pick(rng, TITLES),
        allocationPct: 100,
        isOpenRole: true,
        createdAt: now,
      });
    }
  }

  // Every group gets a leader, who manages the leads of everything beneath it —
  // which is what makes the reporting lines diverge from the delivery tree.
  const leaderOf = new Map<string, string>();
  for (const unit of units) {
    if (unit.kind === "team") {
      if (unit.leadPersonId) leaderOf.set(unit.id, unit.leadPersonId);
      continue;
    }
    const leader = makePerson();
    leader.title = "Director";
    people.push(leader);
    unit.leadPersonId = leader.id;
    leaderOf.set(unit.id, leader.id);
    assignments.push({
      id: randomUUID(),
      workspaceId,
      personId: leader.id,
      orgUnitId: unit.id,
      roleOnTeam: "Director",
      allocationPct: 100,
      isOpenRole: false,
      createdAt: now,
    });
  }
  const personById = new Map(people.map((p) => [p.id, p]));
  for (const unit of units) {
    const leadId = leaderOf.get(unit.id);
    const parentLead = unit.parentId ? leaderOf.get(unit.parentId) : null;
    if (!leadId || !parentLead || leadId === parentLead) continue;
    const lead = personById.get(leadId);
    if (lead) lead.managerId = parentLead;
  }

  // A tail of supporters serve a second team somewhere else in the company —
  // the cross-cutting case, and the reason a person can sit in two orbits.
  const supporters = Math.round(people.length * 0.12);
  for (let i = 0; i < supporters && teams.length > 1; i++) {
    const person = people[Math.floor(rng() * people.length)];
    const team = teams[Math.floor(rng() * teams.length)].unit;
    if (assignments.some((a) => a.personId === person.id && a.orgUnitId === team.id)) continue;
    assignments.push({
      id: randomUUID(),
      workspaceId,
      personId: person.id,
      orgUnitId: team.id,
      roleOnTeam: person.title,
      allocationPct: 30 + Math.floor(rng() * 30),
      createdAt: now,
      isOpenRole: false,
    });
  }

  return { disciplines, units, people, assignments };
}
