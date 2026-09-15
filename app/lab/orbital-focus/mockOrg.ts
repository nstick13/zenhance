/**
 * Invented, deterministic enterprise used only by the orbital-focus lab.
 * It deliberately has a ragged twelve-rung shape and teams at many depths.
 */

export type OrgNode = {
  id: string;
  name: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  isTeam: boolean;
  headcount: number;
  totalPeople: number;
  totalTeams: number;
};

export type Org = {
  rootId: string;
  nodes: OrgNode[];
  byId: Map<string, OrgNode>;
  totals: { units: number; teams: number; people: number; maxDepth: number };
};

const PROPER = [
  "Aurora", "Beacon", "Cascade", "Delta", "Everest", "Falcon", "Granite", "Harbour",
  "Iris", "Juniper", "Keystone", "Lumen", "Meridian", "Nimbus", "Orchid", "Pioneer",
  "Quartz", "Ridge", "Summit", "Trident", "Union", "Vertex", "Willow", "Zephyr",
  "Anchor", "Bluff", "Copper", "Dune", "Ember", "Fjord", "Glade", "Hollow",
] as const;

const GROUP_WORDS = [
  ["Group"],
  ["Division", "Sector"],
  ["Region", "Portfolio"],
  ["Business Unit", "Practice"],
  ["Function", "Chapter"],
  ["Programme", "Domain"],
  ["Area", "Cluster"],
  ["Stream", "Guild"],
] as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMockOrg(
  opts: { people?: number; maxDepth?: number; seed?: number; rootName?: string } = {},
): Org {
  const targetPeople = opts.people ?? 2400;
  const maxDepth = opts.maxDepth ?? 11;
  const rand = mulberry32(opts.seed ?? 20260915);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const byId = new Map<string, OrgNode>();
  const nodes: OrgNode[] = [];
  const usedNames = new Set<string>();
  let nextId = 0;
  let teamNumber = 0;

  const make = (name: string, parent: OrgNode | null, isTeam: boolean): OrgNode => {
    const node: OrgNode = {
      id: `unit-${nextId++}`,
      name,
      parentId: parent?.id ?? null,
      childIds: [],
      depth: parent ? parent.depth + 1 : 0,
      isTeam,
      headcount: 0,
      totalPeople: 0,
      totalTeams: 0,
    };
    nodes.push(node);
    byId.set(node.id, node);
    parent?.childIds.push(node.id);
    return node;
  };

  const groupName = (depth: number) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const words = GROUP_WORDS[Math.min(depth, GROUP_WORDS.length - 1)];
      const name = `${pick(PROPER)} ${pick(words)}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    return `Unit ${nextId}`;
  };

  const root = make(opts.rootName ?? "Northwind Freight & Logistics", null, false);
  root.headcount = 1;
  let remaining = targetPeople - 1;

  const grow = (parent: OrgNode, depth: number) => {
    if (remaining <= 0) return;
    const childCount = depth <= 1 ? 3 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 3);
    for (let i = 0; i < childCount && remaining > 0; i++) {
      const teamChance = depth < 2 ? 0.06 : Math.min(0.85, 0.12 + depth * 0.09);
      if (depth >= maxDepth || rand() < teamChance) {
        const size = Math.min(remaining, 5 + Math.floor(rand() * 9));
        const team = make(`${pick(PROPER)} Team ${++teamNumber}`, parent, true);
        team.headcount = size;
        remaining -= size;
      } else {
        const group = make(groupName(depth), parent, false);
        group.headcount = 1;
        remaining -= 1;
        grow(group, depth + 1);
      }
    }
  };
  grow(root, 0);

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    node.totalPeople += node.headcount;
    node.totalTeams += node.isTeam ? 1 : 0;
    if (node.parentId) {
      const parent = byId.get(node.parentId)!;
      parent.totalPeople += node.totalPeople;
      parent.totalTeams += node.totalTeams;
    }
  }

  return {
    rootId: root.id,
    nodes,
    byId,
    totals: {
      units: nodes.length,
      teams: nodes.filter((node) => node.isTeam).length,
      people: root.totalPeople,
      maxDepth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
    },
  };
}
