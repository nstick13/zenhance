import type { Node } from '../grow/GrowLab';

/** Invented, deterministic 45-person organisation for interaction QA only.
 * It resembles the shape of Digital Tailoring without reading customer data
 * or writing to the database. All metrics below are explicitly sample values.
 */
const GROUPS = [
  {
    id: 'product', name: 'Product & Technology', purpose: 'Build the digital product',
    teams: [
      ['platform', 'Platform Engineering', 5],
      ['experience', 'Product Experience', 5],
      ['data', 'Data & Insights', 5],
    ] as const,
  },
  {
    id: 'commercial', name: 'Commercial', purpose: 'Grow and support customer relationships',
    teams: [
      ['sales', 'Sales', 5],
      ['marketing', 'Marketing', 5],
      ['success', 'Customer Success', 5],
    ] as const,
  },
  {
    id: 'operations', name: 'Operations', purpose: 'Deliver reliable day-to-day service',
    teams: [
      ['fulfilment', 'Fulfilment', 6],
      ['support', 'Service Operations', 6],
    ] as const,
  },
] as const;

const FIRST = [
  'Ana', 'Marcus', 'Priya', 'Tom', 'Lena', 'Sam', 'Iris', 'Dev', 'Nia', 'Omar',
  'Maya', 'Ben', 'Zara', 'Theo', 'Rina',
];
const LAST = ['Whitfield', 'Reyn', 'Solanki', 'Okafor', 'Brandt', 'Ellery', 'Vale'];
const ROLES = ['Engineer', 'Designer', 'Product Manager', 'Analyst', 'Coordinator', 'Specialist'];

const nodes: Node[] = [{
  id: 'est-root', kind: 'team', parentId: null, name: 'Digital Tailoring Supplies',
  role: null, purpose: 'Create and deliver custom products',
}];
let personIndex = 0;
const addPerson = (parentId: string, role: string) => {
  const number = personIndex++;
  nodes.push({
    id: `est-person-${number}`,
    kind: 'person',
    parentId,
    name: `${FIRST[number % FIRST.length]} ${LAST[Math.floor(number / FIRST.length)]}`,
    role,
    purpose: null,
  });
};
for (const group of GROUPS) {
  nodes.push({ id: `est-${group.id}`, kind: 'team', parentId: 'est-root', name: group.name,
    role: null, purpose: group.purpose });
  addPerson(`est-${group.id}`, `${group.name} Lead`);
  for (const [id, name, count] of group.teams) {
    nodes.push({ id: `est-${id}`, kind: 'team', parentId: `est-${group.id}`, name,
      role: null, purpose: `Deliver ${name.toLowerCase()} work` });
    for (let index = 0; index < count; index++) addPerson(`est-${id}`, ROLES[(personIndex + index) % ROLES.length]);
  }
}

export const establishedNodes: Node[] = nodes;

export const establishedRings: Record<string, { delivery: number; sprint: number; health: number }> =
  Object.fromEntries(nodes.filter((node) => node.kind === 'team').map((node, index) => [node.id, {
    delivery: [0.82, 0.64, 0.91, 0.73, 0.56][index % 5],
    sprint: [0.68, 0.87, 0.61, 0.76, 0.93][index % 5],
    health: [0.89, 0.78, 0.67, 0.92, 0.74][index % 5],
  }]));
