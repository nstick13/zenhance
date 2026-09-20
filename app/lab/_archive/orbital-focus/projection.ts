import type { Org, OrgNode } from "./mockOrg";


export const TAU = Math.PI * 2;

export type ViewRole = "centre" | "near" | "context" | "background";

export type PlacedNode = {
  node: OrgNode;
  x: number;
  y: number;
  angle: number;
  radius: number;
  role: ViewRole;
  open: boolean;
  collapsed: boolean;
  onRoute: boolean;
};

export type Projection = {
  mode: "global" | "local" | "unsnapped";
  placed: PlacedNode[];
  byId: Map<string, PlacedNode>;
  breadcrumb: OrgNode[];
  hiddenChildren: number;
  hiddenSiblings: number;
  hasMoreAncestors: boolean;
  pressure: number;
};

export type ProjectionOptions = {
  focusId: string | null;
  selectedId: string | null;
  markBudget: number;
  bandStep: number;
  snapping: boolean;
};

const GLOBAL_RADII = [64, 46, 36, 29];
const LOCAL_CENTRE_R = 64;
const LOCAL_NEAR_R = 42;
const LOCAL_CONTEXT_R = 30;

const round = (value: number) => Math.round(value * 1000) / 1000;

export function pathToRoot(org: Org, nodeId: string): OrgNode[] {
  const out: OrgNode[] = [];
  for (let node = org.byId.get(nodeId); node; node = node.parentId ? org.byId.get(node.parentId) : undefined) {
    out.unshift(node);
  }
  return out;
}

/** Open the real tree breadth-first. A node that cannot open stays as itself,
 * with its real subtree totals; no invented aggregate is introduced. */
function globalOpenSet(org: Org, markBudget: number) {
  const open = new Set<string>();
  const queue = [org.rootId];
  let marks = 1;
  for (let index = 0; index < queue.length; index++) {
    const node = org.byId.get(queue[index])!;
    if (node.depth >= 3 || node.childIds.length === 0) continue;
    if (marks + node.childIds.length > markBudget) continue;
    open.add(node.id);
    marks += node.childIds.length;
    queue.push(...node.childIds);
  }
  return open;
}

function representedTree(org: Org, open: ReadonlySet<string>) {
  const nodes: OrgNode[] = [];
  const visit = (id: string) => {
    const node = org.byId.get(id);
    if (!node) return;
    nodes.push(node);
    if (open.has(id)) node.childIds.forEach(visit);
  };
  visit(org.rootId);
  return nodes;
}

function circularMean(angles: number[]) {
  if (angles.length === 0) return -Math.PI / 2;
  const x = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
  const y = angles.reduce((sum, angle) => sum + Math.sin(angle), 0);
  return Math.atan2(y, x);
}

/** Stable angular order: visible leaves are evenly packed in tree order and
 * every open parent sits at the angular centroid of its visible children. */
function anglesFor(org: Org, open: ReadonlySet<string>) {
  const leaves: OrgNode[] = [];
  const collect = (id: string) => {
    const node = org.byId.get(id)!;
    if (!open.has(id) || node.childIds.length === 0) {
      leaves.push(node);
      return;
    }
    node.childIds.forEach(collect);
  };
  collect(org.rootId);

  const angles = new Map<string, number>();
  leaves.forEach((node, index) => angles.set(node.id, -Math.PI / 2 + ((index + 0.5) / leaves.length) * TAU));
  const centre = (id: string): number => {
    const known = angles.get(id);
    if (known !== undefined) return known;
    const node = org.byId.get(id)!;
    const angle = circularMean(node.childIds.filter((child) => open.has(id) || angles.has(child)).map(centre));
    angles.set(id, angle);
    return angle;
  };
  centre(org.rootId);
  return angles;
}

function selectedPath(org: Org, selectedId: string | null) {
  return new Set(selectedId && org.byId.has(selectedId) ? pathToRoot(org, selectedId).map((node) => node.id) : []);
}

function pressureOf(nodes: PlacedNode[], bandStep: number) {
  const byDepth = new Map<number, PlacedNode[]>();
  nodes.forEach((placed) => byDepth.set(placed.node.depth, [...(byDepth.get(placed.node.depth) ?? []), placed]));
  let pressure = 0;
  for (const [depth, items] of byDepth) {
    if (depth === 0) continue;
    const demand = items.reduce((sum, item) => sum + item.radius * 2 + 18, 0);
    pressure = Math.max(pressure, demand / (TAU * depth * bandStep));
  }
  return pressure;
}

export function globalProjection(org: Org, opts: ProjectionOptions): Projection {
  const open = globalOpenSet(org, Math.max(6, opts.markBudget));
  const nodes = representedTree(org, open);
  const angles = anglesFor(org, open);
  const route = selectedPath(org, opts.selectedId);
  const placed = nodes.map((node): PlacedNode => {
    const angle = angles.get(node.id) ?? 0;
    const orbit = node.depth * opts.bandStep;
    return {
      node,
      x: node.depth === 0 ? 0 : round(Math.cos(angle) * orbit),
      y: node.depth === 0 ? 0 : round(Math.sin(angle) * orbit),
      angle,
      radius: GLOBAL_RADII[node.depth] ?? GLOBAL_RADII[GLOBAL_RADII.length - 1],
      role: node.depth === 0 ? "centre" : "near",
      open: open.has(node.id),
      collapsed: node.childIds.length > 0 && !open.has(node.id),
      onRoute: route.has(node.id),
    };
  });
  return {
    mode: "global",
    placed,
    byId: new Map(placed.map((node) => [node.node.id, node])),
    breadcrumb: [],
    hiddenChildren: 0,
    hiddenSiblings: 0,
    hasMoreAncestors: false,
    pressure: pressureOf(placed, opts.bandStep),
  };
}

function localSelection(org: Org, focus: OrgNode, markBudget: number) {
  const ancestors = pathToRoot(org, focus.id).slice(0, -1).reverse();
  const parent = ancestors[0];
  const siblings = parent ? parent.childIds.filter((id) => id !== focus.id).map((id) => org.byId.get(id)!) : [];
  const children = focus.childIds.map((id) => org.byId.get(id)!);
  const selected = new Set<string>([focus.id]);
  ancestors.slice(0, 2).forEach((node) => selected.add(node.id));

  let remaining = Math.max(0, markBudget - selected.size);
  const shownChildren = children.slice(0, remaining);
  shownChildren.forEach((node) => selected.add(node.id));
  remaining -= shownChildren.length;

  const shownSiblings = siblings.slice(0, Math.min(8, remaining));
  shownSiblings.forEach((node) => selected.add(node.id));
  remaining -= shownSiblings.length;

  const shownGrandchildren: OrgNode[] = [];
  for (const child of shownChildren) {
    for (const id of child.childIds) {
      if (remaining <= 0) break;
      const node = org.byId.get(id)!;
      selected.add(node.id);
      shownGrandchildren.push(node);
      remaining--;
    }
    if (remaining <= 0) break;
  }

  return {
    ancestors,
    shownChildren,
    shownSiblings,
    shownGrandchildren,
    selected,
    hiddenChildren: children.length - shownChildren.length,
    hiddenSiblings: siblings.length - shownSiblings.length,
  };
}

function localPositions(org: Org, focus: OrgNode, opts: ProjectionOptions) {
  const choice = localSelection(org, focus, Math.max(8, opts.markBudget));
  const positions = new Map<string, { x: number; y: number; angle: number; role: ViewRole }>();
  positions.set(focus.id, { x: 0, y: 0, angle: 0, role: "centre" });

  choice.ancestors.slice(0, 2).forEach((node, index) => {
    positions.set(node.id, {
      x: -(index + 1) * opts.bandStep,
      y: 0,
      angle: Math.PI,
      role: index === 0 ? "near" : "context",
    });
  });

  const childArc = Math.PI * 1.42;
  choice.shownChildren.forEach((node, index, all) => {
    const angle = all.length === 1 ? 0 : -childArc / 2 + (index / (all.length - 1)) * childArc;
    positions.set(node.id, {
      x: round(Math.cos(angle) * opts.bandStep),
      y: round(Math.sin(angle) * opts.bandStep),
      angle,
      role: "near",
    });
  });

  for (const child of choice.shownChildren) {
    const grandchildren = choice.shownGrandchildren.filter((node) => node.parentId === child.id);
    const parentAngle = positions.get(child.id)?.angle ?? 0;
    const slice = Math.min(0.72, childArc / Math.max(2, choice.shownChildren.length));
    grandchildren.forEach((node, index, all) => {
      const angle = all.length === 1 ? parentAngle : parentAngle - slice / 2 + (index / (all.length - 1)) * slice;
      positions.set(node.id, {
        x: round(Math.cos(angle) * opts.bandStep * 2),
        y: round(Math.sin(angle) * opts.bandStep * 2),
        angle,
        role: "context",
      });
    });
  }

  const parent = choice.ancestors[0];
  if (parent) {
    const gap = LOCAL_CONTEXT_R * 2 + 14;
    choice.shownSiblings.forEach((node, index) => {
      // Never use the parent's own zero slot: peers alternate above and below
      // it, then walk outward. This keeps faded context from becoming a pile.
      const slot = (Math.floor(index / 2) + 1) * (index % 2 === 0 ? -1 : 1);
      positions.set(node.id, {
        x: -opts.bandStep,
        y: round(slot * gap),
        angle: Math.PI,
        role: "context",
      });
    });
  }

  return { choice, positions };
}

/** Positions for the snap-off comparison. Fixed CEO+n radii remain intact;
 * local nodes are disclosed, but nothing is pulled toward the focus. */
function masterPositions(org: Org, bandStep: number) {
  const open = new Set(org.nodes.filter((node) => node.childIds.length > 0).map((node) => node.id));
  const angles = anglesFor(org, open);
  return new Map(
    org.nodes.map((node) => {
      const angle = angles.get(node.id) ?? 0;
      const radius = node.depth * bandStep;
      return [node.id, { x: round(Math.cos(angle) * radius), y: round(Math.sin(angle) * radius), angle }];
    }),
  );
}

export function focusProjection(org: Org, opts: ProjectionOptions): Projection {
  const focus = opts.focusId ? org.byId.get(opts.focusId) : undefined;
  if (!focus) return globalProjection(org, opts);
  const { choice, positions: pulled } = localPositions(org, focus, opts);
  const master = opts.snapping ? null : masterPositions(org, opts.bandStep);
  const route = selectedPath(org, opts.selectedId ?? focus.id);
  const open = new Set<string>([focus.id, ...choice.shownChildren.filter((node) =>
    choice.shownGrandchildren.some((grandchild) => grandchild.parentId === node.id),
  ).map((node) => node.id)]);

  const placed = [...choice.selected]
    .map((id) => org.byId.get(id)!)
    .map((node): PlacedNode => {
      const local = pulled.get(node.id)!;
      const position = master?.get(node.id) ?? local;
      const role = local.role;
      return {
        node,
        x: position.x,
        y: position.y,
        angle: position.angle,
        radius: role === "centre" ? LOCAL_CENTRE_R : role === "near" ? LOCAL_NEAR_R : LOCAL_CONTEXT_R,
        role,
        open: open.has(node.id),
        collapsed: node.childIds.length > 0 && !open.has(node.id),
        onRoute: route.has(node.id),
      };
    });

  return {
    mode: opts.snapping ? "local" : "unsnapped",
    placed,
    byId: new Map(placed.map((node) => [node.node.id, node])),
    breadcrumb: pathToRoot(org, focus.id),
    hiddenChildren: choice.hiddenChildren,
    hiddenSiblings: choice.hiddenSiblings,
    hasMoreAncestors: choice.ancestors.length > 2,
    pressure: 0,
  };
}

export function project(org: Org, opts: ProjectionOptions) {
  return opts.focusId ? focusProjection(org, opts) : globalProjection(org, opts);
}
