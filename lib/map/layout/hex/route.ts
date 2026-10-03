/**
 * Finding a chain a way home that does not go through anybody (Greg,
 * 2026-10-01).
 *
 * *"Preference non-overlapping connection lines — either they do not overlap
 * other connection lines, and where possible connection lines do not run
 * underneath other nodes except in cases of sibling chaining… we should
 * preserve how the connection lines emanate from the tiles… we want
 * [hexagon centre point] to [hexagon side midpoint]."*
 *
 * ## The constraint that makes this hard
 *
 * A chain may only run along the six directions from a cell's centre to the
 * middle of one of its sides — 30°, 90°, 150° and their opposites on a
 * flat-top lattice. Those are the directions to a neighbour, so a chain is a
 * **walk from cell to cell**, never a line drawn across them.
 *
 * An attempt on 2026-09-30 relaxed that, adding the six centre-to-*vertex*
 * directions so a two-step hop could go straight. It measured beautifully —
 * chains through tiles fell from 54% to 23% — and it looked wrong, and Greg
 * reverted it. The angles a hexagon emanates from are not negotiable; what the
 * chain does between them is.
 *
 * ## So: route, do not draw
 *
 * A* across the lattice from child to parent. Free ground is cheap; a tile
 * someone else is standing on is expensive; a **sibling** is nearly free,
 * because a chain threading its own family is the one case Greg exempted and
 * the one case that cannot be designed away — with more than five children,
 * somebody has to reach the parent past somebody else.
 *
 * Turning costs a little, so a chain prefers to run straight and bend only
 * when it must. And cells already carrying a chain cost more, so the second
 * chain through a gap goes round rather than lying on top of the first. That
 * is the "do not overlap other connection lines" half, and it is why the
 * caller routes every chain through one `Router` rather than one at a time.
 */
import type { OrbitalTree } from "@/lib/map/layout/model";
import {
  type Cell,
  type Point,
  DIRECTIONS,
  cellKey,
  cellToWorld,
  hexDistance,
  neighbours,
} from "@/lib/map/layout/hex/coords";

/** One step of clear ground. Everything else is priced against this. */
const STEP = 10;

/** Bending. Small — a bend is worth taking to avoid a tile, not worth taking
 *  to save a step. */
const TURN = 12;

/**
 * Extra bend cost per cell of the chain's span — straighter the further it has
 * to go.
 *
 * Greg, 2026-10-03: *"let's also put a stronger opinion on connection lines
 * being straighter the longer they need to be — so the closer a connection
 * line chain is to a parental node, the higher the ability for it to curl; the
 * longer the connection line the straighter it is — this is intended to create
 * straight branches rather than switchbacks that spider all over the place."*
 *
 * A one-step hop can bend for nothing. A chain crossing twenty cells pays
 * `TURN + 20 * this` for every corner, which buys a long detour round an
 * obstacle rather than a staircase through the middle of one. The cost is set
 * from the chain's **span**, not from how far it has already travelled, so it
 * is the same at both ends and the search stays admissible.
 */
const TURN_PER_SPAN = 6;

/** Running under somebody who is not family. The thing being avoided. */
const THROUGH_A_STRANGER = 260;

/** Running under a sibling. Greg's exemption: with more than five children one
 *  of them has to reach the parent past another, so this has to be possible —
 *  just not preferred. */
const THROUGH_A_SIBLING = 6;

/** Sharing ground with a chain already routed. Enough that the second chain
 *  through a gap takes the next one along if there is one. */
const SHARED_WITH_A_CHAIN = 30;

/**
 * Leaving or arriving on a side of a node that another chain already uses.
 *
 * Greg, 2026-10-01: *"routing does not fan out, rather it can bullishly hold to
 * whatever origin side of its original hexagon it was originally. Perhaps
 * connection lines are too fixed to a given side of their host hexagon?"*
 *
 * The observation was right and this was the wrong place to fix it. **Off, and
 * the measurements are why.** On the 1,000-person company, only 11 parents in
 * 53 give every child its own face. Charging for a reused face does move that
 * — to 28 in 53 at a price of 400 — but the router has exactly one way to
 * reach a different side, which is to walk further round, so chains crossing
 * somebody else's tile went 26 → 66 and the longest chain went 8 steps → 10.
 * That is more tangle bought with less, not more.
 *
 * Nor is any of it free. Priced at 1, 2, 3, 5 — small enough to break ties and
 * nothing else — the fan does not move at all (54 → 53 one-face parents on
 * Northwind). There are no ties: a different face always costs distance.
 *
 * So the fan has to come from where the children sit, not from how the chains
 * run, and it did — see `DOORSTEP` in `allocate.ts`. Keeping a child next to
 * its parent gives it a face of its own for nothing. This stays as one number
 * because it is the only knob on the other half of the trade: set it to 400 to
 * see the fan the router can buy, and what it costs.
 */
const SIDE_ALREADY_USED = 0;

/** How far past the direct distance a chain may wander looking for clear
 *  ground. A chain that has to trek is a chain that should have been a
 *  straight unattractive line instead. */
/**
 * Joining a route that is already going your way — a **trunk**.
 *
 * Greg, 2026-10-03: *"in-team connection lines should preferentially chain via
 * established routes, preferencing as few corners as possible, rather than
 * attempt shortest-route. Think tree and branches rather than mesh."*
 *
 * The condition is precise: a chain may join a route whose destination is its
 * own destination, or any ancestor of it. Going to the same place, or further
 * up the same line, is the same journey — so share the ground. Going somewhere
 * else is a different journey, and the ordinary `SHARED_WITH_A_CHAIN` charge
 * still applies, which is what keeps unrelated chains off each other.
 *
 * Priced below a step, so a chain will go a little out of its way to find a
 * trunk. It is a per-step cost rather than a discount, because A* cannot have
 * a negative edge and still be trusted.
 */
const JOIN_A_TRUNK = 5;

const DETOUR_ALLOWANCE = 10;

export type RoutedChain = {
  unitId: string;
  parentId: string;
  /** The cells walked, child first, parent last. */
  cells: Cell[];
  /** Those cells in world space, with the straight runs collapsed so the
   *  renderer draws one line per run rather than one per step. */
  points: Point[];
  /** Tiles it had to pass under that were not siblings. Zero is the aim. */
  through: number;
};

/** Collapse a walk into its straight runs: consecutive steps in the same
 *  direction become one segment, so a chain is drawn as lines, not as a chain
 *  of tiny ones. */
export function corners(cells: readonly Cell[], size: number): Point[] {
  if (cells.length < 2) return cells.map((c) => cellToWorld(c, size));
  const out: Point[] = [cellToWorld(cells[0], size)];
  for (let i = 1; i < cells.length - 1; i++) {
    const inQ = cells[i].q - cells[i - 1].q;
    const inR = cells[i].r - cells[i - 1].r;
    const outQ = cells[i + 1].q - cells[i].q;
    const outR = cells[i + 1].r - cells[i].r;
    if (inQ !== outQ || inR !== outR) out.push(cellToWorld(cells[i], size));
  }
  out.push(cellToWorld(cells[cells.length - 1], size));
  return out;
}

type Node = { key: string; cell: Cell; from: number; cost: number; prev: Node | null };

/**
 * Routes every chain in a picture, remembering where the earlier ones went so
 * the later ones can keep out of their way.
 *
 * Order therefore matters, and is the caller's to choose — `routeAll` takes
 * them shallowest first, so the trunk gets the clean ground and the twigs bend
 * around it.
 */
export class Router {
  private readonly occupied: ReadonlyMap<string, string>;
  private readonly size: number;
  /** cell key → how many routed chains already run through it. */
  private readonly used = new Map<string, number>();
  /** cell key → the destinations the chains over it are heading for, so a
   *  later chain can tell whether this ground is going its way. */
  private readonly toward = new Map<string, Set<string>>();
  /** cell key → which of the six sides already carry a chain in or out. */
  private readonly sides = new Map<string, Set<number>>();

  constructor(occupied: ReadonlyMap<string, string>, size: number) {
    this.occupied = occupied;
    this.size = size;
  }

  /** What one cell costs to walk through, for a chain that may pass siblings. */
  private cellCost(
    key: string,
    siblings: ReadonlySet<string>,
    joinable?: (destinationId: string) => boolean,
  ): number {
    const who = this.occupied.get(key);
    // Ground already carrying a chain that is going where this one is going.
    // The trunk is cheaper than open ground, so branches gather onto it — but
    // it is only the *ground* that is discounted. Walking under a stranger
    // costs the same whether or not somebody else did it first; a trunk is not
    // a licence to trespass.
    let onMyTrunk = false;
    if (joinable) {
      const heading = this.toward.get(key);
      if (heading) for (const dest of heading) if (joinable(dest)) { onMyTrunk = true; break; }
    }
    let cost = onMyTrunk ? JOIN_A_TRUNK : STEP;
    if (who) cost += siblings.has(who) ? THROUGH_A_SIBLING : THROUGH_A_STRANGER;
    if (!onMyTrunk) cost += (this.used.get(key) ?? 0) * SHARED_WITH_A_CHAIN;
    return cost;
  }

  /**
   * A way from `from` to `to` along the six side-midpoint directions, dodging
   * what it can. Falls back to the straight walk if nothing better is reachable
   * inside the detour allowance — a chain always arrives.
   */
  route(
    from: Cell,
    to: Cell,
    siblings: ReadonlySet<string>,
    /** Whether a route already heading for `destinationId` is going this
     *  chain's way, and so may be joined. See `JOIN_A_TRUNK`. */
    joinable?: (destinationId: string) => boolean,
  ): Cell[] {
    const goal = cellKey(to);
    // Two neighbours always get the straight hop between them. Charging for a
    // busy side there would send a child that is *touching* its parent on a
    // detour, which is absurd whatever the fan is worth.
    const span = hexDistance(from, to);
    const adjacent = span <= 1;
    const limit = span + DETOUR_ALLOWANCE;
    // Long chains run straight; short ones may curl. See `TURN_PER_SPAN`.
    const turnCost = TURN + TURN_PER_SPAN * span;
    const open: Node[] = [{ key: cellKey(from), cell: from, from: 0, cost: 0, prev: null }];
    const best = new Map<string, number>([[cellKey(from), 0]]);
    let found: Node | null = null;

    while (open.length > 0) {
      // Cheapest first. The frontier stays small enough that a scan beats the
      // bookkeeping of a heap.
      let at = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].cost + hexDistance(open[i].cell, to) * STEP
          < open[at].cost + hexDistance(open[at].cell, to) * STEP) at = i;
      }
      const node = open.splice(at, 1)[0];
      if (node.key === goal) { found = node; break; }
      if (node.from >= limit) continue;
      if ((best.get(node.key) ?? Infinity) < node.cost) continue;

      for (const next of neighbours(node.cell)) {
        const key = cellKey(next);
        const steps = node.from + 1;
        if (steps > limit) continue;
        if (hexDistance(next, to) + steps > limit) continue;
        // The two ends are the chain's own business, never an obstacle.
        // A side already carrying a chain costs extra at both of them, so a
        // node's six faces get used rather than one of them six times.
        let sideCost = 0;
        if (adjacent) {
          // nothing to spread: the chain is one step long
        } else if (!node.prev) {
          const side = sideBetween(from, next);
          if (side >= 0 && this.sides.get(cellKey(from))?.has(side)) sideCost += SIDE_ALREADY_USED;
        }
        if (!adjacent && key === goal) {
          const side = sideBetween(to, node.cell);
          if (side >= 0 && this.sides.get(goal)?.has(side)) sideCost += SIDE_ALREADY_USED;
        }
        const cost = node.cost
          + (key === goal ? STEP : this.cellCost(key, siblings, joinable))
          + (turns(node, next) ? turnCost : 0)
          + sideCost;
        if (cost >= (best.get(key) ?? Infinity)) continue;
        best.set(key, cost);
        open.push({ key, cell: next, from: steps, cost, prev: node });
      }
    }

    if (!found) return straightWalk(from, to);
    const walk: Cell[] = [];
    for (let n: Node | null = found; n; n = n.prev) walk.push(n.cell);
    return walk.reverse();
  }

  /** Record a routed chain so later ones keep off it. The two ends do not
   *  count — every chain starts and finishes on a tile. */
  claim(cells: readonly Cell[], destinationId?: string): void {
    for (let i = 1; i < cells.length - 1; i++) {
      const key = cellKey(cells[i]);
      this.used.set(key, (this.used.get(key) ?? 0) + 1);
      if (destinationId !== undefined) {
        const heading = this.toward.get(key) ?? new Set<string>();
        heading.add(destinationId);
        this.toward.set(key, heading);
      }
    }
    if (cells.length < 2) return;
    // Both ends: the side this chain leaves by, and the side it arrives by.
    const mark = (at: Cell, toward: Cell) => {
      const side = sideBetween(at, toward);
      if (side < 0) return;
      const key = cellKey(at);
      const taken = this.sides.get(key) ?? new Set<number>();
      taken.add(side);
      this.sides.set(key, taken);
    };
    mark(cells[0], cells[1]);
    mark(cells[cells.length - 1], cells[cells.length - 2]);
  }

  /** How many tiles a walk passes under that are not its own ends or siblings. */
  strangersUnder(cells: readonly Cell[], siblings: ReadonlySet<string>): number {
    let n = 0;
    for (let i = 1; i < cells.length - 1; i++) {
      const who = this.occupied.get(cellKey(cells[i]));
      if (who && !siblings.has(who)) n++;
    }
    return n;
  }

  get worldSize(): number {
    return this.size;
  }
}

/**
 * Route every chain in a company.
 *
 * **Shallowest first.** The trunk gets the clear ground and the twigs bend
 * around it, which is both what a reader expects and what keeps the important
 * lines straight.
 */
export function routeAll(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  size: number,
): RoutedChain[] {
  const occupied = new Map<string, string>();
  for (const [id, cell] of cells) occupied.set(cellKey(cell), id);
  const router = new Router(occupied, size);

  const order = [...tree.units.values()]
    .filter((u) => u.parentId && cells.has(u.id) && cells.has(u.parentId))
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  const out: RoutedChain[] = [];
  for (const unit of order) {
    const parentId = unit.parentId!;
    // A chain may thread its own family: its parent, and its siblings.
    const siblings = new Set<string>([unit.id, parentId]);
    for (const id of tree.units.get(parentId)?.childIds ?? []) siblings.add(id);

    // Tree and branches: a chain may join a route heading for its own
    // destination, or anywhere further up its own line home.
    const line = new Set<string>();
    for (let up: string | null = parentId; up; up = tree.units.get(up)?.parentId ?? null) line.add(up);
    const walk = router.route(
      cells.get(unit.id)!, cells.get(parentId)!, siblings, (dest) => line.has(dest),
    );
    router.claim(walk, parentId);
    out.push({
      unitId: unit.id,
      parentId,
      cells: walk,
      points: corners(walk, size),
      through: router.strangersUnder(walk, siblings),
    });
  }
  return out;
}

/** Which of the six directions leads from `from` to its neighbour `to`. */
const sideBetween = (from: Cell, to: Cell): number =>
  DIRECTIONS.findIndex((d) => d.q === to.q - from.q && d.r === to.r - from.r);

const turns = (node: Node, next: Cell): boolean => {
  if (!node.prev) return false;
  return (
    node.cell.q - node.prev.cell.q !== next.q - node.cell.q ||
    node.cell.r - node.prev.cell.r !== next.r - node.cell.r
  );
};

/** The plain walk, used when the search cannot do better: step toward the
 *  target along whichever axis is furthest behind. */
export function straightWalk(from: Cell, to: Cell): Cell[] {
  const out: Cell[] = [from];
  let at = from;
  let guard = 0;
  while (cellKey(at) !== cellKey(to) && guard++ < 200) {
    let best = at;
    let bestD = Infinity;
    for (const n of neighbours(at)) {
      const d = hexDistance(n, to);
      if (d < bestD) { bestD = d; best = n; }
    }
    at = best;
    out.push(at);
  }
  return out;
}
