/**
 * The orbital map's data model: the org snapshot folded into a tree of units
 * with *seats* hanging off them. Pure — no DB, no React — so the layout and
 * its tests never need a workspace.
 *
 * Two decisions worth knowing, both from the concept drawing (Greg,
 * 2026-09-13):
 *
 * - **Humans exist at every rung.** A seat is created for each assignment,
 *   and also for a unit's lead when they hold no assignment there — which is
 *   how a group-level human (a value-stream lead, the delivery lead) appears
 *   orbiting a group rather than only appearing down in a team. The schema
 *   already allows an assignment against any unit, so this is a rendering
 *   truth, not a data fiction.
 * - **A pass-through root is merged away.** Orgs routinely have a holding
 *   node with exactly one child ("Digital Tailoring Supplies" → "Delivery
 *   Group"). Drawn honestly that puts the entire company off to one side of
 *   the centre, which reads as broken. The root keeps its own name and
 *   absorbs its only child's children and seats instead.
 */

export type UnitInput = {
  id: string;
  name: string;
  parentId: string | null;
  isExternal?: boolean;
  leadPersonId?: string | null;
  vendorName?: string | null;
};

export type PersonInput = {
  id: string;
  name: string;
  title?: string | null;
};

export type AssignmentInput = {
  personId: string | null;
  orgUnitId: string;
  allocationPct?: number;
  isOpenRole?: boolean;
  roleOnTeam?: string | null;
};

export type OrgInput = {
  units: UnitInput[];
  people: PersonInput[];
  assignments: AssignmentInput[];
};

export type SeatKind = "member" | "lead" | "open";

export type Seat = {
  id: string;
  unitId: string;
  personId: string | null;
  name: string;
  role: string | null;
  kind: SeatKind;
  allocationPct: number;
  /** This person holds seats in more than one unit — the supporter case. */
  shared: boolean;
  /** In-progress work items orbiting this seat; supplied by the caller. */
  workCount: number;
};

export type UnitNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  childIds: string[];
  seatIds: string[];
  isExternal: boolean;
  vendorName: string | null;
  /** Angular pull: how much of a parent's sector this subtree deserves. */
  weight: number;
  /** Everyone at or below this node — what the map labels a unit with. */
  totalSeats: number;
};

export type OrbitalTree = {
  rootId: string;
  units: Map<string, UnitNode>;
  seats: Map<string, Seat>;
  maxDepth: number;
};

export type BuildOptions = {
  /** Work items per person, for the deepest zoom rung. Defaults to none. */
  workCountFor?: (personId: string) => number;
  /** Merge a root that has exactly one child into that child. Default true. */
  mergePassThroughRoot?: boolean;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Roots first, then anything whose parent is missing — a unit pointing at a
 *  parent outside the snapshot is treated as a root rather than dropped. */
function findRoots(units: UnitInput[]): UnitInput[] {
  const ids = new Set(units.map((u) => u.id));
  return units.filter((u) => !u.parentId || !ids.has(u.parentId));
}

export function buildOrbitalTree(input: OrgInput, opts: BuildOptions = {}): OrbitalTree {
  const { workCountFor, mergePassThroughRoot = true } = opts;
  const peopleById = new Map(input.people.map((p) => [p.id, p]));
  const unitInputs = new Map(input.units.map((u) => [u.id, u]));

  // --- seats -------------------------------------------------------------
  // Count each person's units first so a supporter can be marked shared on
  // every seat they hold, not just the ones discovered after the second.
  const unitsPerPerson = new Map<string, Set<string>>();
  for (const a of input.assignments) {
    if (!a.personId || a.isOpenRole) continue;
    if (!unitInputs.has(a.orgUnitId)) continue;
    const set = unitsPerPerson.get(a.personId) ?? new Set<string>();
    set.add(a.orgUnitId);
    unitsPerPerson.set(a.personId, set);
  }

  const seats = new Map<string, Seat>();
  const seatIdsByUnit = new Map<string, string[]>();
  const addSeat = (seat: Seat) => {
    seats.set(seat.id, seat);
    const list = seatIdsByUnit.get(seat.unitId) ?? [];
    list.push(seat.id);
    seatIdsByUnit.set(seat.unitId, list);
  };

  let openIndex = 0;
  for (const a of input.assignments) {
    if (!unitInputs.has(a.orgUnitId)) continue;
    if (a.isOpenRole || !a.personId) {
      addSeat({
        id: `open-${a.orgUnitId}-${openIndex++}`,
        unitId: a.orgUnitId,
        personId: null,
        name: a.roleOnTeam ?? "Open role",
        role: a.roleOnTeam ?? null,
        kind: "open",
        allocationPct: a.allocationPct ?? 100,
        shared: false,
        workCount: 0,
      });
      continue;
    }
    const person = peopleById.get(a.personId);
    if (!person) continue;
    const unit = unitInputs.get(a.orgUnitId)!;
    addSeat({
      id: `seat-${a.orgUnitId}-${a.personId}`,
      unitId: a.orgUnitId,
      personId: a.personId,
      name: person.name,
      role: a.roleOnTeam ?? person.title ?? null,
      kind: unit.leadPersonId === a.personId ? "lead" : "member",
      allocationPct: a.allocationPct ?? 100,
      shared: (unitsPerPerson.get(a.personId)?.size ?? 0) > 1,
      workCount: workCountFor?.(a.personId) ?? 0,
    });
  }

  // A lead with no assignment on the unit they lead still belongs to it.
  for (const u of input.units) {
    if (!u.leadPersonId) continue;
    const id = `seat-${u.id}-${u.leadPersonId}`;
    if (seats.has(id)) continue;
    const person = peopleById.get(u.leadPersonId);
    if (!person) continue;
    addSeat({
      id,
      unitId: u.id,
      personId: u.leadPersonId,
      name: person.name,
      role: person.title ?? "Lead",
      kind: "lead",
      allocationPct: 100,
      shared: (unitsPerPerson.get(u.leadPersonId)?.size ?? 0) > 0,
      workCount: workCountFor?.(u.leadPersonId) ?? 0,
    });
  }

  // --- units -------------------------------------------------------------
  const childrenOf = new Map<string, UnitInput[]>();
  for (const u of input.units) {
    if (!u.parentId || !unitInputs.has(u.parentId)) continue;
    const list = childrenOf.get(u.parentId) ?? [];
    list.push(u);
    childrenOf.set(u.parentId, list);
  }

  const roots = findRoots(input.units).sort(byName);
  const units = new Map<string, UnitNode>();

  // A synthetic centre only when the snapshot genuinely has several roots;
  // the normal case is one company at the middle.
  let rootId: string;
  if (roots.length === 1) {
    rootId = roots[0].id;
  } else {
    rootId = "orbital-root";
    units.set(rootId, {
      id: rootId,
      name: "Organisation",
      parentId: null,
      depth: 0,
      childIds: roots.map((r) => r.id),
      seatIds: [],
      isExternal: false,
      vendorName: null,
      weight: 1,
      totalSeats: 0,
    });
  }

  const visit = (u: UnitInput, parentId: string | null, depth: number) => {
    const kids = (childrenOf.get(u.id) ?? []).slice().sort(byName);
    units.set(u.id, {
      id: u.id,
      name: u.name,
      parentId,
      depth,
      childIds: kids.map((k) => k.id),
      seatIds: seatIdsByUnit.get(u.id) ?? [],
      isExternal: u.isExternal ?? false,
      vendorName: u.vendorName ?? null,
      weight: 1,
      totalSeats: 0,
    });
    for (const k of kids) visit(k, u.id, depth + 1);
  };
  for (const r of roots) visit(r, roots.length === 1 ? null : rootId, roots.length === 1 ? 0 : 1);

  const tree: OrbitalTree = { rootId, units, seats, maxDepth: 0 };
  if (mergePassThroughRoot) mergeRoot(tree);
  recomputeDerived(tree);
  return tree;
}

/** Absorb an only-child root so the company sits at the centre of its own
 *  org rather than orbiting a holding node. Repeats while it applies. */
function mergeRoot(tree: OrbitalTree): void {
  for (;;) {
    const root = tree.units.get(tree.rootId);
    if (!root || root.childIds.length !== 1) return;
    const only = tree.units.get(root.childIds[0]);
    if (!only) return;
    // Only a *holding* node gets absorbed. A single child with nothing under
    // it isn't passing anything through — it's the only thing the company has,
    // and swallowing it means someone who has just added their first value
    // stream watches it vanish (Greg, 2026-09-19, the guided start).
    if (only.childIds.length === 0) return;
    root.childIds = only.childIds;
    root.seatIds = [...root.seatIds, ...only.seatIds];
    for (const id of only.seatIds) {
      const seat = tree.seats.get(id);
      if (seat) seat.unitId = root.id;
    }
    for (const id of root.childIds) {
      const child = tree.units.get(id);
      if (child) child.parentId = root.id;
    }
    tree.units.delete(only.id);
  }
}

/** Depths, subtree weights and headcounts, in one post-order walk. */
function recomputeDerived(tree: OrbitalTree): void {
  let maxDepth = 0;
  const walk = (id: string, depth: number): { weight: number; seats: number } => {
    const node = tree.units.get(id);
    if (!node) return { weight: 0, seats: 0 };
    node.depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    let weight = 0;
    let seats = node.seatIds.length;
    for (const childId of node.childIds) {
      const sub = walk(childId, depth + 1);
      weight += sub.weight;
      seats += sub.seats;
    }
    // A leaf's pull comes from the people on it; a branch's from its subtree.
    node.weight = Math.max(1, weight || node.seatIds.length);
    node.totalSeats = seats;
    return { weight: node.weight, seats };
  };
  walk(tree.rootId, 0);
  tree.maxDepth = maxDepth;
}

/** Every unit at a given rung, in stable order. */
export function unitsAtDepth(tree: OrbitalTree, depth: number): UnitNode[] {
  return [...tree.units.values()].filter((u) => u.depth === depth);
}

/**
 * Where a drag has moved things, held apart from the org itself. Dropping a
 * node on another rung *is* reparenting it — a rung is defined by whose child
 * you are — so structure needs only the one map.
 */
export type StructureOverrides = {
  unitParent?: Map<string, string>;
  seatUnit?: Map<string, string>;
};

function cloneTree(tree: OrbitalTree): OrbitalTree {
  const units = new Map<string, UnitNode>();
  for (const [id, u] of tree.units) units.set(id, { ...u, childIds: [...u.childIds], seatIds: [...u.seatIds] });
  const seats = new Map<string, Seat>();
  for (const [id, s] of tree.seats) seats.set(id, { ...s });
  return { rootId: tree.rootId, units, seats, maxDepth: tree.maxDepth };
}

/** Would moving `unitId` under `parentId` put it inside its own subtree? */
function wouldCycle(tree: OrbitalTree, unitId: string, parentId: string): boolean {
  let cursor: string | null = parentId;
  const guard = tree.units.size + 1;
  for (let i = 0; i < guard && cursor; i++) {
    if (cursor === unitId) return true;
    cursor = tree.units.get(cursor)?.parentId ?? null;
  }
  return false;
}

/**
 * Apply drag results to a copy of the tree. Anything impossible — a missing
 * node, the centre being reparented, a move that would detach a subtree into
 * itself — is skipped rather than throwing, so a stale override left over
 * from an earlier snapshot can never break the map.
 */
export function applyOverrides(tree: OrbitalTree, overrides: StructureOverrides): OrbitalTree {
  if (!overrides.unitParent?.size && !overrides.seatUnit?.size) return tree;
  const next = cloneTree(tree);

  for (const [unitId, parentId] of overrides.unitParent ?? []) {
    const unit = next.units.get(unitId);
    const parent = next.units.get(parentId);
    if (!unit || !parent || unitId === next.rootId) continue;
    if (unit.parentId === parentId) continue;
    if (wouldCycle(next, unitId, parentId)) continue;
    const oldParent = unit.parentId ? next.units.get(unit.parentId) : null;
    if (oldParent) oldParent.childIds = oldParent.childIds.filter((id) => id !== unitId);
    unit.parentId = parentId;
    if (!parent.childIds.includes(unitId)) parent.childIds.push(unitId);
  }

  for (const [seatId, unitId] of overrides.seatUnit ?? []) {
    const seat = next.seats.get(seatId);
    const target = next.units.get(unitId);
    if (!seat || !target || seat.unitId === unitId) continue;
    const from = next.units.get(seat.unitId);
    if (from) from.seatIds = from.seatIds.filter((id) => id !== seatId);
    seat.unitId = unitId;
    if (!target.seatIds.includes(seatId)) target.seatIds.push(seatId);
  }

  recomputeDerived(next);
  return next;
}
