/**
 * Local branch geography — how a large company is drawn (Greg, 2026-09-21).
 *
 * The ring map puts every unit on a company-wide ring by reporting depth. At
 * twelve rungs that becomes a giant target: the outer rings are tens of
 * thousands of units round, mostly empty, and nothing is legible at the zoom
 * that shows the whole company. Here the orbital grammar is kept *locally*
 * instead: each unit's children gather on an orbit around their own parent,
 * fanned away from the grandparent, and every branch grows independently. A
 * shallow branch stays compact; a deep one extends like a chain. Depth is
 * carried by the visible routes, not by distance from the centre.
 *
 * The walk has two passes.
 *
 *   bottom-up  Each unit's whole branch is laid out in the unit's own frame —
 *              the unit at the origin, facing +x (away from its parent). Its
 *              children sit on one orbit, at the smallest radius where their
 *              branches, *seen from this unit*, occupy angular wedges that fit
 *              side by side within the fan. Every mark in a child's branch lies
 *              inside that child's wedge, and wedges never overlap, so no two
 *              branches can collide however they are shaped.
 *   top-down   Frames are composed from the company outward into positions.
 *
 * Why wedges and not bubbles. Clearing each child's *entire* descendant
 * envelope doubles the reach at every nested level — ChatGPT's grow study hit
 * exactly that (LAB.md, 2026-09-20: roughly a trillion units at 30 levels). A
 * wedge measures a branch by the angle it subtends from the parent, which a
 * long thin chain barely does; so a chain costs its length, not its length
 * doubled at every link.
 *
 * Deterministic and local by construction: a branch's own shape depends only
 * on what is inside it. A change deep in one branch can alter its ancestors'
 * orbits, and so shift its siblings bodily, but never reshapes the inside of
 * any branch it is not part of.
 */
import { polar, seatFurnitureReach, seatRingRadius, unitOuterExtent, type Point } from "./geometry";
import {
  placeUnitSeats,
  seatRingCount,
  widestGap,
  type Link,
  type OrbitalScene,
  type PlacedSeat,
  type PlacedUnit,
} from "./layout";
import type { OrbitalTree, UnitNode } from "./model";
import { headcountDotPx, sizeIndex } from "./size";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** World radius of the smallest and the largest unit disc. Interpolated by
 *  area on the headcount size index, so disc size means the same thing on the
 *  map as the dot does at overview. */
export const LOCAL_MIN_R = 34;
export const LOCAL_MAX_R = 230;
/** Clear space kept between any two footprints. */
export const BRANCH_GAP = 46;
/** Least angular air between neighbouring sibling wedges. */
const WEDGE_GAP = 0.05;
/** A unit's children fan away from its parent, never round behind it. */
export const FAN_MAX = 200 * DEG;
/** How much of the distance to its nearest neighbour a dot may swell into when
 *  zoomed out — two neighbours at this share still leave a tenth clear. */
const CEILING_SHARE = 0.45;
/** How many nearest units a dot measures itself against when it swells. */
const NEAR_COUNT = 8;

export function localUnitRadius(index: number): number {
  const a = LOCAL_MIN_R * LOCAL_MIN_R;
  const b = LOCAL_MAX_R * LOCAL_MAX_R;
  return Math.sqrt(a + (b - a) * Math.min(1, Math.max(0, index)));
}

type Disk = { x: number; y: number; f: number };

type Branch = {
  /** Every footprint in the branch, in the branch root's own frame. */
  disks: Disk[];
  /** Where each child sits, in the root's frame: its direction, its distance,
   *  and which way its own frame faces (normally straight away). */
  children: Map<string, { angle: number; distance: number; facing: number }>;
  /** Direction of this unit's parent, in its own frame — straight behind,
   *  except for the company's only child, which has the company in a gap. */
  parentDir: number;
  /** The orbit the children were packed on before each was drawn inward. */
  orbit: number;
};

/** Disks bucketed on a square grid, so "does this disk come within `gap` of
 *  any other?" costs a handful of neighbours instead of the whole branch. */
class DiskGrid {
  private cells = new Map<string, Disk[]>();
  private cell: number;
  private maxF = 0;
  constructor(disks: Disk[], cell: number) {
    this.cell = Math.max(1, cell);
    for (const d of disks) this.add(d);
  }
  add(d: Disk) {
    this.maxF = Math.max(this.maxF, d.f);
    const k = `${Math.floor(d.x / this.cell)},${Math.floor(d.y / this.cell)}`;
    const list = this.cells.get(k);
    if (list) list.push(d);
    else this.cells.set(k, [d]);
  }
  clear(d: Disk, gap: number): boolean {
    const reach = d.f + this.maxF + gap;
    const x0 = Math.floor((d.x - reach) / this.cell);
    const x1 = Math.floor((d.x + reach) / this.cell);
    const y0 = Math.floor((d.y - reach) / this.cell);
    const y1 = Math.floor((d.y + reach) / this.cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (const o of this.cells.get(`${gx},${gy}`) ?? []) {
          if (Math.hypot(d.x - o.x, d.y - o.y) < d.f + o.f + gap) return false;
        }
      }
    }
    return true;
  }
}

/** The angular wedge a child's branch occupies, seen from its parent, when
 *  the child sits at distance `rho` straight ahead. Null when any mark in the
 *  branch would come within `clear` of the parent's centre. */
function wedgeAt(disks: Disk[], rho: number, clear: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of disks) {
    const x = rho + d.x;
    const y = d.y;
    const dist = Math.hypot(x, y);
    const reach = d.f + BRANCH_GAP / 2;
    if (dist - reach < clear) return null;
    const a = Math.atan2(y, x);
    const half = Math.asin(Math.min(1, reach / dist));
    if (a - half < lo) lo = a - half;
    if (a + half > hi) hi = a + half;
  }
  return { lo, hi };
}

export type LocalLayoutOptions = {
  /** Direction of the company's first child. Default: due north. */
  startAngle?: number;
  /** 0 = one circular sibling orbit. 1 = use all safe branch-sensitive
   * radial variation. Always supplied from visual complexity in production. */
  radialLooseness?: number;
};

export function layoutBranches(tree: OrbitalTree, opts: LocalLayoutOptions = {}): OrbitalScene {
  const startAngle = opts.startAngle ?? -Math.PI / 2;
  const radialLooseness = Math.min(1, Math.max(0, opts.radialLooseness ?? 1));
  const root = tree.units.get(tree.rootId);
  const company = Math.max(1, root?.totalSeats ?? 1);

  // --- sizes ---------------------------------------------------------------
  const radius = new Map<string, number>();
  const footprint = new Map<string, number>();
  const dotPx = new Map<string, number>();
  for (const unit of tree.units.values()) {
    const index = sizeIndex(unit.totalSeats, company);
    const r = localUnitRadius(unit.id === tree.rootId ? 1 : index);
    let busiest = 0;
    for (const id of unit.seatIds) busiest = Math.max(busiest, tree.seats.get(id)?.workCount ?? 0);
    const rings = seatRingCount(r, unit.seatIds.length);
    radius.set(unit.id, r);
    footprint.set(unit.id, unitOuterExtent(r, rings, rings > 0 ? seatFurnitureReach(busiest) : 0));
    dotPx.set(unit.id, headcountDotPx(unit.totalSeats, company, { master: unit.id === tree.rootId }));
  }
  const kidsOf = (unit: UnitNode) => unit.childIds.filter((id) => tree.units.has(id));

  // --- bottom-up: each branch in its own frame -----------------------------
  const branches = new Map<string, Branch>();

  /** Rotate then translate a branch's disks into its parent's frame. */
  const carry = (disks: Disk[], angle: number, distance: number, facing: number): Disk[] => {
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    const ox = distance * Math.cos(angle);
    const oy = distance * Math.sin(angle);
    return disks.map((d) => ({ x: ox + d.x * cos - d.y * sin, y: oy + d.x * sin + d.y * cos, f: d.f }));
  };

  const build = (id: string, wholeCircle = false): Branch => {
    const unit = tree.units.get(id)!;
    const kids = kidsOf(unit);
    const own = footprint.get(id)!;
    const isRoot = id === tree.rootId;
    const children = new Map<string, { angle: number; distance: number; facing: number }>();

    if (kids.length === 0) {
      const branch = { disks: [{ x: 0, y: 0, f: own }], children, parentDir: Math.PI, orbit: 0 };
      branches.set(id, branch);
      return branch;
    }

    // A company with a single child is a holding node: drawn honestly it
    // would squeeze the whole organisation into one fan with the company off
    // at its foot. The child takes the whole circle instead, and the company
    // sits beside it in the widest gap its children leave.
    if (isRoot && kids.length === 1) {
      const only = build(kids[0], true);
      const pocketGrid = new DiskGrid(only.disks, 2 * Math.max(...only.disks.map((d) => d.f)));
      const nearest = own + footprint.get(kids[0])! + BRANCH_GAP;
      // Look all the way round the child for the closest pocket the company
      // fits into without touching anything. Directions are tried outward
      // from straight behind, so a tie keeps the first — the calmest — one.
      let gapDir = Math.PI;
      let distance = Infinity;
      for (let step = 0; step < 72; step++) {
        const dir = Math.PI + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * (TAU / 72);
        for (let d = nearest; d < distance; d *= 1.03) {
          const at = polar(dir, d);
          if (pocketGrid.clear({ x: at.x, y: at.y, f: own }, BRANCH_GAP)) {
            distance = d;
            gapDir = dir;
            break;
          }
        }
      }
      only.parentDir = gapDir;
      const angle = startAngle;
      const facing = angle + Math.PI - gapDir;
      children.set(kids[0], { angle, distance, facing });
      const branch = {
        disks: [{ x: 0, y: 0, f: own }, ...carry(only.disks, angle, distance, facing)],
        children,
        parentDir: Math.PI,
        orbit: distance,
      };
      branches.set(id, branch);
      return branch;
    }

    const childBranches = kids.map((k) => build(k));
    const available = isRoot || wholeCircle ? TAU : FAN_MAX;
    const around = isRoot || wholeCircle;
    const clear = own + BRANCH_GAP / 2;
    const fits = (rho: number) => {
      const wedges: { lo: number; hi: number }[] = [];
      let total = WEDGE_GAP * (around ? kids.length : kids.length - 1);
      for (const b of childBranches) {
        const w = wedgeAt(b.disks, rho, clear);
        if (!w) return null;
        wedges.push(w);
        total += w.hi - w.lo;
      }
      return total <= available ? { wedges, total } : null;
    };

    // Smallest orbit that clears this unit and lets the wedges sit side by
    // side: grow until it fits, then bisect back down to the edge.
    let low = own + Math.min(...kids.map((k) => footprint.get(k)!)) + BRANCH_GAP;
    let high = low;
    let fit = fits(high);
    for (let i = 0; i < 60 && !fit; i++) {
      low = high;
      high *= 1.6;
      fit = fits(high);
    }
    if (!fit) throw new Error(`Orbit for ${id} did not converge`);
    for (let i = 0; i < 28 && high - low > 0.5; i++) {
      const mid = (low + high) / 2;
      const attempt = fits(mid);
      if (attempt) {
        high = mid;
        fit = attempt;
      } else {
        low = mid;
      }
    }
    const rho = high;

    // Lay the wedges edge to edge: centred on "straight ahead" for a branch,
    // spread evenly round the whole circle for the company.
    const gap = around ? WEDGE_GAP + (TAU - fit.total) / kids.length : WEDGE_GAP;
    const span = fit.wedges.reduce((sum, w) => sum + (w.hi - w.lo), 0) + gap * (kids.length - 1);
    let cursor = around ? startAngle - (fit.wedges[0].hi - fit.wedges[0].lo) / 2 : -span / 2;
    const placed = kids.map((k, i) => {
      const w = fit!.wedges[i];
      const angle = cursor - w.lo;
      cursor += w.hi - w.lo + gap;
      return { id: k, angle, distance: rho, disks: carry(childBranches[i].disks, angle, rho, angle) };
    });

    // Radial looseness. One shared orbit proves the wedges disjoint and is
    // the right, calm drawing for a simple company. As visual complexity
    // grows, branch shape is allowed to pull a child toward the nearest safe
    // distance on its own ray. Deep/narrow branches get more of that room;
    // broad branches stay nearer the shared orbit. Every candidate is checked
    // against final neighbour positions, so variation remains collision-free.
    const own0: Disk = { x: 0, y: 0, f: own };
    const cell = 2 * Math.max(own, ...placed.flatMap((p) => p.disks.map((d) => d.f)));
    // Circular orbits (the shipped map) need none of this search, and it is
    // the most expensive thing in the walk.
    for (let i = 0; radialLooseness > 0 && i < placed.length; i++) {
      const child = placed[i];
      const others = new DiskGrid([own0, ...placed.flatMap((p, j) => (j === i ? [] : p.disks))], cell);
      const local = childBranches[i].disks;
      const clearAt = (distance: number) =>
        carry(local, child.angle, distance, child.angle).every((d) => others.clear(d, BRANCH_GAP));
      let inner = own + footprint.get(child.id)! + BRANCH_GAP;
      let outer = child.distance;
      if (inner >= outer) continue;
      if (clearAt(inner)) outer = inner;
      else {
        for (let step = 0; step < 18 && outer - inner > 2; step++) {
          const mid = (inner + outer) / 2;
          if (clearAt(mid)) outer = mid;
          else inner = mid;
        }
      }
      if (outer < child.distance && radialLooseness > 0) {
        let varied = child.distance - (child.distance - outer) * radialLooseness;
        // The clear set along a ray need not be perfectly continuous for a
        // hooked branch. Both endpoints are proven safe; if the interpolated
        // point falls in a pocket, choose the nearer safe endpoint.
        if (!clearAt(varied)) varied = radialLooseness < 0.5 ? child.distance : outer;
        child.distance = varied;
        child.disks = carry(local, child.angle, varied, child.angle);
      }
    }

    for (const p of placed) children.set(p.id, { angle: p.angle, distance: p.distance, facing: p.angle });
    const branch = {
      disks: [own0, ...placed.flatMap((p) => p.disks)],
      children,
      parentDir: Math.PI,
      orbit: rho,
    };
    branches.set(id, branch);
    return branch;
  };
  build(tree.rootId);

  // --- top-down: frames into positions -------------------------------------
  const units: PlacedUnit[] = [];
  const seats: PlacedSeat[] = [];
  const links: Link[] = [];
  const place = (id: string, at: Point, facing: number, hasParent: boolean) => {
    const unit = tree.units.get(id)!;
    const branch = branches.get(id)!;
    const r = radius.get(id)!;
    const kids = kidsOf(unit);
    const childDirections = kids.map((k) => facing + (branch.children.get(k)?.angle ?? 0));

    const home = hasParent ? facing + branch.parentDir : startAngle;
    const occupied = [...childDirections, ...(hasParent ? [home] : [])];
    const fanAngle = occupied.length > 0 ? widestGap(occupied) : startAngle;
    const fanSpan = placeUnitSeats(tree, unit, at, r, fanAngle, home, { seats, links });

    units.push({
      id,
      name: unit.name,
      parentId: unit.parentId,
      depth: unit.depth,
      x: at.x,
      y: at.y,
      r,
      angle: Math.atan2(at.y, at.x),
      sector: { center: facing, halfSpan: Math.PI },
      seatFanAngle: fanAngle,
      seatFanSpan: fanSpan,
      seatRingRadius: seatRingRadius(r, 0),
      leadAngle: home,
      seatIds: unit.seatIds,
      childIds: kids,
      isExternal: unit.isExternal,
      vendorName: unit.vendorName,
      totalSeats: unit.totalSeats,
      drawCeiling: r,
      dotPx: dotPx.get(id),
      childOrbit: branch.orbit,
      outward: facing,
      footprint: footprint.get(id),
    });

    kids.forEach((k, i) => {
      const spot = branch.children.get(k)!;
      const offset = polar(childDirections[i], spot.distance);
      const childAt = { x: at.x + offset.x, y: at.y + offset.y };
      links.push({
        id: `link-${k}`,
        kind: "unit",
        sourceId: id,
        targetId: k,
        from: at,
        to: childAt,
        depth: unit.depth + 1,
      });
      place(k, childAt, facing + spot.facing, true);
    });
  };
  place(tree.rootId, { x: 0, y: 0 }, 0, false);

  // --- how far each dot may swell when zoomed out --------------------------
  // Bounded by the nearest other unit, so an inflated dot can never swallow a
  // neighbour. A coarse grid keeps this linear on a big company.
  const cell = Math.max(1, ...units.map((u) => footprint.get(u.id)!)) * 2;
  const grid = new Map<string, PlacedUnit[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const u of units) {
    const k = key(u.x, u.y);
    const list = grid.get(k);
    if (list) list.push(u);
    else grid.set(k, [u]);
  }
  for (const u of units) {
    const cx = Math.floor(u.x / cell);
    const cy = Math.floor(u.y / cell);
    // Widen the search until it has enough candidates, then one ring more so
    // nothing just outside the square is missed.
    const found: { id: string; d: number }[] = [];
    const wanted = Math.min(NEAR_COUNT, units.length - 1);
    let extra = wanted <= 0 ? 0 : -1;
    for (let ring = 1; ring <= 64 && wanted > 0; ring++) {
      found.length = 0;
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          for (const other of grid.get(`${gx},${gy}`) ?? []) {
            if (other === u) continue;
            found.push({ id: other.id, d: Math.hypot(other.x - u.x, other.y - u.y) });
          }
        }
      }
      if (found.length >= wanted && extra < 0) extra = ring + 1;
      if (extra >= 0 && ring >= extra) break;
    }
    found.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
    const nearest = found[0]?.d ?? Infinity;
    u.near = found.slice(0, NEAR_COUNT);
    u.drawCeiling = Math.max(u.r, Number.isFinite(nearest) ? nearest * CEILING_SHARE : u.r * 4);
  }

  // --- settled extent ------------------------------------------------------
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let extent = 0;
  for (const u of units) {
    const f = footprint.get(u.id)!;
    minX = Math.min(minX, u.x - f);
    minY = Math.min(minY, u.y - f);
    maxX = Math.max(maxX, u.x + f);
    maxY = Math.max(maxY, u.y + f);
    extent = Math.max(extent, Math.hypot(u.x, u.y) + f);
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const seatById = new Map(seats.map((s) => [s.id, s]));
  const seatsByUnit = new Map<string, PlacedSeat[]>();
  for (const s of seats) {
    const list = seatsByUnit.get(s.unitId);
    if (list) list.push(s);
    else seatsByUnit.set(s.unitId, [s]);
  }
  return {
    units,
    seats,
    bands: [],
    links,
    unitById,
    seatById,
    seatsByUnit,
    extent,
    maxDepth: tree.maxDepth,
    geography: "local",
    bounds: { minX, minY, maxX, maxY },
  };
}
