/**
 * A team's inside, laid out on its own ground (2026-10-03).
 *
 * Greg: *"only load team contents when the zoom level approaches them. Load and
 * manage the team area for sure, but don't pull all the data about every human
 * on load. Furthermore, load locally — so only what a screen can see, let the
 * rest lazy-load."*
 *
 * ## Why this can exist at all
 *
 * Because of `claimRegion` in `allocate.ts`. A team reserves a hexagonal region
 * before any of its people stand on it, and nobody else may enter — so the
 * question *"where does this person sit?"* stopped being a question about the
 * company and became a question about one team's own disc. That is the whole
 * reason the inside of a team can be worked out when the camera arrives rather
 * than when the page loads.
 *
 * Nothing here reads the plane, the other teams, or the camera. Given the same
 * region and the same members it returns the same cells, whatever else is on
 * the map and whatever order the teams are asked about — which is Law 1 held at
 * a smaller scale, and what makes the answer safe to cache and safe to throw
 * away.
 *
 * ## What it is trying to do, in the same order as the engine outside
 *
 * 1. **The team is one patch.** A member takes a cell on the edge of its own
 *    family — its manager or any colleague already seated — so a team of fifty
 *    with spans of two to five is a blob rather than a chain.
 * 2. **It grows away from the way home.** The seat is on the near edge of the
 *    region, the chain home arrives there, and the reporting tree runs inward
 *    across the team's own ground. Nobody has to decide which way is which: the
 *    region is in front of you by construction.
 * 3. **A manager keeps room for their own reports** — the doorstep price, which
 *    matters more inside a team than anywhere else, because an in-team tree is
 *    all spans of two to five and they are all competing for the same disc.
 *
 * ## What it does when the ground runs out
 *
 * It says so. `REGION_SLACK` means a team of seven is given ground for ten, so
 * running out is a real event rather than a rounding error — a team that has
 * grown past its reservation. Those members come back in `spilled` and the
 * caller decides: the lab counts them on screen. Quietly putting them on the
 * neighbour's ground is the one thing a reserved region must never do.
 */
import {
  type Cell,
  cellKey,
  hexDistance,
  neighbours,
  spiral,
  worldAngle,
} from "@/lib/map/layout/hex/coords";
import { type Region, fanAngles } from "@/lib/map/layout/hex/allocate";

/** Who reports to whom inside one team. `parentId` is another member, or the
 *  team itself for whoever hangs directly off it. */
export type InteriorMember = { id: string; parentId: string };

export type Interior = {
  /** member id → its cell. The team's own seat is not included; the caller
   *  already has it. */
  cells: Map<string, Cell>;
  /** Members the region had no room for, in the order they were asked for. */
  spilled: string[];
  /** Members that got a cell but could not touch their own family. Rare inside
   *  a region, and still better than leaving somebody out. */
  exclaves: Set<string>;
};

/**
 * The allocator's own weights, for the allocator's own reasons — see
 * `allocate.ts`. They are re-declared rather than imported because they mean
 * something slightly different in here: there is only ever one group on this
 * ground, so the two terms that price *other people's* territory
 * (`KEEP_TOGETHER`, `TOO_CLOSE`) have nothing to say and are absent. What is
 * left is the shape of a family, which is the same problem at both scales.
 */
const SPACE_WEIGHT = 9;
const DEGREE_PENALTY = 1.2;
const REACH_PENALTY = 200;
const DOORSTEP = 150;
/** How far to look when asking how much open ground a cell opens onto. */
const LOOKAHEAD_RING = 2;

const TAU = Math.PI * 2;
const angleGap = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % TAU + TAU) % TAU);
  return Math.min(d, TAU - d);
};

export function layoutInterior(options: {
  teamId: string;
  /** Where the team's own node stands — the near edge of its region. */
  seat: Cell;
  region: Region;
  /** The direction the chain home leaves in. The tree grows the other way. */
  homeAngle: number;
  members: readonly InteriorMember[];
}): Interior {
  const { teamId, seat, region, homeAngle, members } = options;
  const cells = new Map<string, Cell>();
  const spilled: string[] = [];
  const exclaves = new Set<string>();
  if (members.length === 0) return { cells, spilled, exclaves };

  // Only angles are compared below, and those are scale-free.
  const SIZE = 1;

  const taken = new Set<string>([cellKey(seat)]);
  const cellOf = (id: string): Cell | undefined => (id === teamId ? seat : cells.get(id));

  const kids = new Map<string, InteriorMember[]>();
  for (const m of members) {
    const list = kids.get(m.parentId);
    if (list) list.push(m);
    else kids.set(m.parentId, [m]);
  }

  /** How many people hang off each member, all the way down, so the heaviest
   *  sub-tree claims its corridor first — the same reason as outside. */
  const weight = new Map<string, number>();
  const weigh = (id: string): number => {
    const had = weight.get(id);
    if (had !== undefined) return had;
    let n = 1;
    weight.set(id, 1); // a cycle would otherwise spin; the data should not have one
    for (const kid of kids.get(id) ?? []) n += weigh(kid.id);
    weight.set(id, n);
    return n;
  };
  for (const m of members) weigh(m.id);

  /** How many cells next to it a member still needs for its own reports. */
  const needs = new Map<string, number>();
  for (const [parentId, list] of kids) {
    needs.set(parentId, Math.min(list.length, parentId === teamId ? 6 : 5));
  }

  const inside = (cell: Cell): boolean =>
    hexDistance(cell, region.centre) <= region.radius;

  const free = (cell: Cell): boolean => inside(cell) && !taken.has(cellKey(cell));

  const elbowRoom = (cell: Cell): number => {
    let n = 0;
    for (const c of spiral(cell, LOOKAHEAD_RING)) if (free(c)) n++;
    return n;
  };

  /** What taking this cell would cost the managers around it who have not
   *  seated their own reports yet. Nothing while they still have room. */
  const doorstepCost = (candidate: Cell): number => {
    let cost = 0;
    for (const n of neighbours(candidate)) {
      const who = occupantAt(n);
      if (!who) continue;
      const need = needs.get(who) ?? 0;
      if (need <= 0) continue;
      let open = 0;
      for (const side of neighbours(n)) if (free(side)) open++;
      if (open <= need) cost += DOORSTEP * (need - open + 1);
    }
    return cost;
  };

  const occupants = new Map<string, string>([[cellKey(seat), teamId]]);
  function occupantAt(cell: Cell): string | undefined {
    return occupants.get(cellKey(cell));
  }

  const sit = (id: string, cell: Cell, touches: boolean) => {
    cells.set(id, cell);
    taken.add(cellKey(cell));
    occupants.set(cellKey(cell), id);
    if (!touches) exclaves.add(id);
  };

  /** The best free cell on the edge of a family, for a member heading
   *  `desired` from its manager. Rule 1, inside the region. */
  const onFamilyEdge = (
    family: readonly Cell[], parentCell: Cell, desired: number,
  ): Cell | null => {
    const seen = new Set<string>();
    let best: Cell | null = null;
    let bestScore = -Infinity;
    for (const member of family) {
      for (const candidate of neighbours(member)) {
        const key = cellKey(candidate);
        if (seen.has(key) || !free(candidate)) continue;
        seen.add(key);
        const deviation =
          (angleGap(worldAngle(parentCell, candidate, SIZE), desired) * 180) / Math.PI;
        const score =
          elbowRoom(candidate) * SPACE_WEIGHT
          - deviation * DEGREE_PENALTY
          - hexDistance(parentCell, candidate) * REACH_PENALTY
          - doorstepCost(candidate);
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
    return best;
  };

  /** Last resort: the nearest free cell anywhere on the team's own ground.
   *  Produces an in-team exclave rather than leaving somebody out. */
  const anywhereInside = (from: Cell): Cell | null => {
    for (let k = 1; k <= region.radius * 2 + 1; k++) {
      let best: Cell | null = null;
      let bestScore = -Infinity;
      for (const candidate of spiral(from, k)) {
        if (hexDistance(candidate, from) !== k || !free(candidate)) continue;
        const score = elbowRoom(candidate);
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      if (best) return best;
    }
    return null;
  };

  /**
   * Depth-first, heaviest first — and the whole family seated before any of it
   * is descended into, because a child that recurses immediately lets its own
   * descendants wall in the ground its later siblings needed. Both of those are
   * the allocator's hard-won order, and they hold just as much on one disc.
   */
  const place = (parentId: string) => {
    const parentCell = cellOf(parentId);
    if (!parentCell) return;
    const list = (kids.get(parentId) ?? [])
      .slice()
      .sort((a, b) => (weight.get(b.id) ?? 1) - (weight.get(a.id) ?? 1) || a.id.localeCompare(b.id));
    needs.set(parentId, 0); // seating them now; no need to hold ground from ourselves
    if (list.length === 0) return;

    // Away from where this member came from, so the tree keeps running inward
    // instead of doubling back. For the team itself that is away from home.
    const grandparentId = parentId === teamId
      ? null
      : members.find((m) => m.id === parentId)?.parentId ?? null;
    const grandparent = grandparentId ? cellOf(grandparentId) : null;
    const outward = parentId === teamId
      ? homeAngle + Math.PI
      : grandparent ? worldAngle(grandparent, parentCell, SIZE) : homeAngle + Math.PI;
    const desired = fanAngles(outward, list.length);

    const family: Cell[] = [parentCell];
    list.forEach((kid, i) => {
      const edge = onFamilyEdge(family, parentCell, desired[i]);
      const cell = edge ?? anywhereInside(parentCell);
      if (!cell) { spilled.push(kid.id); return; }
      sit(kid.id, cell, edge !== null);
      family.push(cell);
    });

    for (const kid of list) if (cells.has(kid.id)) place(kid.id);
  };

  place(teamId);
  // Anybody whose manager never got a cell — only reachable if the manager
  // spilled — has nowhere to hang from, so they spill too.
  for (const m of members) {
    if (!cells.has(m.id) && !spilled.includes(m.id)) spilled.push(m.id);
  }
  return { cells, spilled, exclaves };
}

/** How many people a region can hold besides the team's own node. */
export const interiorCapacity = (region: Region): number =>
  3 * region.radius * region.radius + 3 * region.radius + 1 - 1;
