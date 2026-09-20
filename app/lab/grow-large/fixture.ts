import type { Node, SampleWorkItem } from '../grow/GrowLab';
import type { StudyRingProgress } from '../grow/visualRules';

/** Entirely invented, deterministic stress fixture. No database or customer data. */
const nodes: Node[] = [];
const teams: Node[] = [];
const work: Record<string, SampleWorkItem[]> = {};

function team(id: string, name: string, parentId: string | null, purpose: string | null = null) {
  const node: Node = { id: `large-${id}`, kind: 'team', parentId, name, role: null, purpose };
  nodes.push(node);
  teams.push(node);
  return node.id;
}

const centre = team('centre', 'Asterline Works · fictional', null, 'Coordinate the whole organisation');

// One unusually deep reporting chain, with side branches so it is not a line
// of thirty identical circles. The last team is exactly CEO+30.
let deepParent = centre;
for (let depth = 1; depth <= 30; depth++) {
  const id = team(`deep-${depth}`, `Continuity layer ${depth}`, deepParent,
    depth % 5 === 0 ? null : `Coordinate continuity layer ${depth}`);
  if (depth > 1 && depth % 3 === 0) {
    team(`deep-spur-${depth}`, `Layer ${depth} support`, deepParent, 'Support the neighbouring layer');
  }
  deepParent = id;
}

// Uneven mainstream branches: different lengths, different side-team counts,
// and several missing purposes make the structure deliberately imperfect.
const branches = [
  { key: 'field', name: 'Field Operations', length: 5, side: 3 },
  { key: 'product', name: 'Products & Platforms', length: 7, side: 2 },
  { key: 'regional', name: 'Regional Network', length: 8, side: 2 },
  { key: 'customer', name: 'Customer Delivery', length: 4, side: 3 },
  { key: 'shared', name: 'Shared Services', length: 3, side: 2 },
  { key: 'ventures', name: 'New Ventures', length: 2, side: 4 },
] as const;
for (const branch of branches) {
  let parent = centre;
  for (let level = 1; level <= branch.length; level++) {
    const id = team(`${branch.key}-${level}`, level === 1 ? branch.name : `${branch.name} · ${level}`,
      parent, level % 4 === 0 ? null : `Deliver ${branch.name.toLowerCase()} work`);
    for (let side = 1; side <= (level < branch.length ? branch.side : 0); side++) {
      team(`${branch.key}-${level}-side-${side}`, `${branch.name} · unit ${level}.${side}`,
        parent, side === 3 ? null : 'Deliver local work');
    }
    parent = id;
  }
}

// A second, unconnected family: ten nested teams with its own local structure.
let floatingParent: string | null = null;
for (let level = 1; level <= 10; level++) {
  const id = team(`floating-${level}`, level === 1 ? 'Independent Cooperative' : `Cooperative layer ${level}`,
    floatingParent, level === 1 ? 'Operate independently for now' : null);
  if (level > 1 && level % 2 === 0 && floatingParent) {
    team(`floating-spur-${level}`, `Cooperative unit ${level}`, floatingParent);
  }
  floatingParent = id;
}

// Spread exactly 1,000 synthetic people over the whole forest. Deep layers
// stay relatively lean; broader, shallower units carry most of the headcount.
const seats = teams.map((node, index) => ({
  node,
  weight: node.id.includes('deep-') ? 1 : index % 11 === 0 ? 0 : index < 45 ? 4 : 2,
  count: 0,
}));
const weightTotal = seats.reduce((sum, seat) => sum + seat.weight, 0);
let allocated = 0;
for (const seat of seats) {
  seat.count = Math.floor(1000 * seat.weight / weightTotal);
  allocated += seat.count;
}
for (let index = 0; allocated < 1000; index = (index + 1) % seats.length) {
  if (seats[index]!.weight === 0) continue;
  seats[index]!.count++;
  allocated++;
}

const roles = ['Coordinator', 'Analyst', 'Engineer', 'Designer', 'Specialist', 'Operator'];
let personIndex = 0;
for (const seat of seats) {
  for (let index = 0; index < seat.count; index++) {
    personIndex++;
    const id = `large-person-${personIndex}`;
    nodes.push({ id, kind: 'person', parentId: seat.node.id,
      name: `Colleague ${String(personIndex).padStart(4, '0')}`,
      role: personIndex % 13 === 0 ? null : roles[personIndex % roles.length]!, purpose: null });
    if (personIndex % 9 === 0) {
      work[id] = [0, 1, 2].map((number) => ({
        id: `${id}-work-${number}`,
        title: ['Review a plan', 'Deliver a change', 'Resolve a blocker'][number]!,
        status: (['done', 'in_progress', 'backlog'] as const)[(personIndex + number) % 3],
      }));
    }
  }
}

export const largeNodes = nodes;
export const largeWork = work;
const localReviewRings = new Set([
  'large-deep-14', 'large-deep-15', 'large-deep-16',
  'large-deep-29', 'large-deep-30',
  'large-floating-9', 'large-floating-10',
]);
export const largeRings: Record<string, StudyRingProgress> = Object.fromEntries(
  teams.filter((node, index) => index < 14 || index % 17 === 0 || localReviewRings.has(node.id))
    .map((node, index) => [node.id, {
    delivery: [0.82, 0.47, 0.71, 0.93][index % 4],
    sprint: [0.67, 0.88, 0.39, 0.76][index % 4],
    health: [0.89, 0.62, 0.76, 0.95][index % 4],
    }]),
);
largeRings['large-centre'].alerts = {
  delivery: { severity: 'watch', description: 'An invented delivery review is nearly due.' },
};
largeRings['large-deep-6'].alerts = {
  health: { severity: 'risk', description: 'An invented capacity issue needs attention.' },
};
