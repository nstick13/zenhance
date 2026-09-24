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
import {
  ROOT_RADIUS,
  UNIT_RADIUS,
  polar,
  seatFurnitureReach,
  seatRingRadius,
  unitOuterExtent,
  type Point,
} from "@/lib/map/layout/geometry";
import {
  placeUnitSeats,
  seatRingCount,
  unitDiscRadius,
  widestGap,
  type Link,
  type OrbitalScene,
  type PlacedSeat,
  type PlacedUnit,
} from "@/lib/map/layout/layout";
import type { OrbitalTree, UnitNode } from "@/lib/map/layout/model";
import { SIZE_BY_HEADCOUNT, headcountDotPx, sizeIndex } from "@/lib/map/layout/size";

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
/** How much wider than the tightest possible orbit a fan is drawn, so that
 *  children have angular room to be pulled inward (see the variation pass).
 *  Spent only when variation is on. */
const ORBIT_SLACK = 0.35;
/**
 * How wide a unit's children may fan, away from its own parent (Greg,
 * 2026-09-24: "those angles can be tightened up considerably — half if
 * possible").
 *
 * It narrows as the company grows, which is his rule and is less strange than
 * it sounds: *"the larger the company, counter-intuitively, the smaller the
 * splay, and the tighter it must follow the 'try to be on the opposite side
 * as the parent' rule."* A small company can afford to open out, because
 * there is nothing else competing for the screen. A large one reads far
 * better as a river system — everything flowing one way, away from the
 * centre — than as a shrub, because the direction a branch runs in is then
 * telling you where you are.
 *
 * Measured from the whole-company legibility figure the geography choice
 * already uses, so the same company always gets the same fan.
 */
export const FAN_SMALL = 100 * DEG;
export const FAN_LARGE = 46 * DEG;
export const fanFor = (complexity: number): number =>
  FAN_SMALL + (FAN_LARGE - FAN_SMALL) * Math.min(1, Math.max(0, complexity));
/** The fan a layout uses when nobody says (small companies, tests). */
export const FAN_MAX = FAN_SMALL;
/** A fan never opens past this: children stay on the far side from their own
 *  parent, whatever it costs. */
export const FAN_WIDE = 190 * DEG;
/** How far the company stands off its only child, as a share of that child's
 *  own orbit — so the trunk of the river is on the same scale as the branches
 *  it feeds, and the two read as two places. */
const ROOT_TRUNK_SHARE = 0.3;
/** Widening steps tried, tightest first, as multiples of the preferred fan. */
const FAN_LADDER = [1, 1.6, 2.6];
/**
 * How much further out a tight fan may push a child before the tightness
 * stops being worth it.
 *
 * Measured on the 2,562-person shape, against a median fan of 102° before
 * this pass: 1.45 gives 78° and a company 50,008 across; 2.0 gives 61° and
 * 65,082; 2.4 gives 56° and 69,658; 4.0 gives 54° and 76,078 — the curve
 * flattens because past a point the branches simply cannot be held any
 * tighter. 2.4 is roughly the halving Greg asked for, at the knee.
 */
const ORBIT_TOLERANCE = 2.4;
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
  /** Which way the company faces. East by default, so the map reads
   *  master-on-the-left and detail to the right (Greg, 2026-09-24). */
  startAngle?: number;
  /** How wide a fan may open. See `fanFor`. */
  fan?: number;
  /** 0 = one circular sibling orbit. 1 = use all safe branch-sensitive
   * radial variation. Always supplied from visual complexity in production. */
  radialLooseness?: number;
};

export function layoutBranches(tree: OrbitalTree, opts: LocalLayoutOptions = {}): OrbitalScene {
  const startAngle = opts.startAngle ?? 0;
  const fan = Math.max(10 * DEG, Math.min(TAU, opts.fan ?? FAN_MAX));
  const radialLooseness = Math.min(1, Math.max(0, opts.radialLooseness ?? 1));
  const root = tree.units.get(tree.rootId);
  const company = Math.max(1, root?.totalSeats ?? 1);

  // --- sizes ---------------------------------------------------------------
  const radius = new Map<string, number>();
  const footprint = new Map<string, number>();
  const dotPx = new Map<string, number>();
  for (const unit of tree.units.values()) {
    const index = sizeIndex(unit.totalSeats, company);
    const isRoot = unit.id === tree.rootId;
    // One size for every unit, grown only when its own people need the room
    // (Greg, 2026-09-24). Headcount sizing is kept, switched off.
    const base = SIZE_BY_HEADCOUNT
      ? localUnitRadius(isRoot ? 1 : index)
      : (isRoot ? ROOT_RADIUS : UNIT_RADIUS);
    const r = unitDiscRadius(base, unit.seatIds.length);
    let busiest = 0;
    for (const id of unit.seatIds) busiest = Math.max(busiest, tree.seats.get(id)?.workCount ?? 0);
    const rings = seatRingCount(r, unit.seatIds.length);
    radius.set(unit.id, r);
    footprint.set(unit.id, unitOuterExtent(r, rings, rings > 0 ? seatFurnitureReach(busiest) : 0));
    // With one size for every unit there is nothing for the overview dot to
    // say, so it says nothing and the painters fall back to the disc.
    if (SIZE_BY_HEADCOUNT) dotPx.set(unit.id, headcountDotPx(unit.totalSeats, company, { master: isRoot }));
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

  const build = (id: string): Branch => {
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

    const childBranches = kids.map((k) => build(k));
    // One child competes with nobody for angle: it only has to clear its
    // parent, and pushing it out until its whole branch subtends less than a
    // fan would send it a very long way for no gain. This is what keeps the
    // company's first child — which carries the entire organisation — beside
    // the company rather than out at the horizon.
    const clear = own + BRANCH_GAP / 2;
    const fitsIn = (rho: number, within: number) => {
      const wedges: { lo: number; hi: number }[] = [];
      let total = WEDGE_GAP * (kids.length - 1);
      for (const b of childBranches) {
        const w = wedgeAt(b.disks, rho, clear);
        if (!w) return null;
        wedges.push(w);
        total += w.hi - w.lo;
      }
      return total <= within ? { wedges, total } : null;
    };

    /** Smallest orbit that clears this unit and lets the wedges sit side by
     *  side inside `within`: grow until it fits, then bisect back to the edge. */
    const orbitFor = (within: number) => {
      let low = own + Math.min(...kids.map((k) => footprint.get(k)!)) + BRANCH_GAP;
      let high = low;
      let fit = fitsIn(high, within);
      for (let i = 0; i < 60 && !fit; i++) {
        low = high;
        high *= 1.6;
        fit = fitsIn(high, within);
      }
      if (!fit) return null;
      for (let i = 0; i < 28 && high - low > 0.5; i++) {
        const mid = (low + high) / 2;
        const attempt = fitsIn(mid, within);
        if (attempt) {
          high = mid;
          fit = attempt;
        } else {
          low = mid;
        }
      }
      return { rho: high, fit, allowed: within };
    };

    // A tight fan is a *preference*, not a cage. Holding one child's branch
    // inside a narrow slice means pushing it out until it subtends that
    // little from here, and for a branch carrying half the company that means
    // the horizon. So the tight fan is tried first and widened, a step at a
    // time, only while widening keeps the orbit from running away — which is
    // Greg's "some variance is needed since this needs to work spatially".
    // One child competes with nobody, so it only has to clear its parent.
    const widest = kids.length === 1 ? TAU : FAN_WIDE;
    const loosest = orbitFor(widest);
    if (!loosest) throw new Error(`Orbit for ${id} did not converge`);
    let chosen = loosest;
    if (kids.length > 1) {
      for (const share of FAN_LADDER) {
        const within = Math.min(widest, fan * share);
        const attempt = orbitFor(within);
        if (attempt && attempt.rho <= loosest.rho * ORBIT_TOLERANCE) {
          chosen = attempt;
          break;
        }
      }
    }
    // The company and its first child are a special case of scale. A lone
    // child only has to clear its parent, which for a chain is right — but
    // the company's one child carries the entire organisation, and its own
    // children stand tens of thousands of units away. Cleared by 46 units,
    // the two read as one blot at the whole-company view, which is what Greg
    // saw: "the immediate child of the master/center node is too close to the
    // center and clashes with the central node." So the company's trunk is
    // measured against what hangs off it.
    if (isRoot && kids.length === 1) {
      const trunk = (branches.get(kids[0])?.orbit ?? 0) * ROOT_TRUNK_SHARE;
      if (trunk > chosen.rho) chosen = { ...chosen, rho: trunk };
    }

    // The angle the chosen fan actually allows, which is what the variation
    // pass may spend its slack from.
    const available = chosen.allowed;
    let { fit } = chosen;
    const high = chosen.rho;
    // Leave a little angular slack before laying the wedges out. At the
    // minimum orbit the wedges exactly fill the fan, so no child has room to
    // come inward — coming inward widens the angle a branch subtends, and
    // there is nowhere for that width to go. Opening the orbit slightly buys
    // every child a slot wider than it needs, and that slack is what variable
    // connection lengths are spent from.
    const rho = high * (1 + ORBIT_SLACK * radialLooseness);
    fit = fitsIn(rho, available) ?? fit;

    // Wedges edge to edge, centred on "straight ahead" — which for the
    // company is `startAngle`, and for everyone else is away from their own
    // parent. Nothing is spread evenly round a circle any more (Greg,
    // 2026-09-24: the first child's children "splay too much… let's instead
    // have them splay tightly just like their children").
    const gap = WEDGE_GAP;
    const span = fit.wedges.reduce((sum, w) => sum + (w.hi - w.lo), 0) + gap * (kids.length - 1);
    let cursor = -span / 2;
    const placed = kids.map((k, i) => {
      const w = fit!.wedges[i];
      const angle = cursor - w.lo;
      cursor += w.hi - w.lo + gap;
      return { id: k, angle, distance: rho, disks: carry(childBranches[i].disks, angle, rho, angle) };
    });

    // Variable connection lengths (Greg, 2026-09-24). One shared orbit is
    // what proves the wedges disjoint, but it leaves a small child out on the
    // same long stem as its biggest sibling. Each child may be drawn back in
    // along its own ray — as far as two things allow, and no further:
    //
    //   space   its branch must stay clear of everything else in this frame;
    //   wedge   its branch must still fit inside the angular slot it was
    //           given, because coming inward widens the angle it subtends.
    //
    // The wedge bound is what keeps Law 4. Without it, a branch drawn inward
    // spills into its neighbour's slot and their connections cross — three of
    // them on the 2,562-person shape, which is how this was found.
    const own0: Disk = { x: 0, y: 0, f: own };
    const cell = 2 * Math.max(own, ...placed.flatMap((p) => p.disks.map((d) => d.f)));
    // The fan's unused angle, shared equally: each child may widen into its
    // own share and no further, so two neighbours can never both claim it.
    const slotExtra = Math.max(0, available - fit.total) / kids.length;
    // The company's trunk is a deliberate distance, not a packing outcome, so
    // the variation pass must not pull it back in.
    const varying = radialLooseness > 0 && !(isRoot && kids.length === 1);
    for (let i = 0; varying && i < placed.length; i++) {
      const child = placed[i];
      const others = new DiskGrid([own0, ...placed.flatMap((p, j) => (j === i ? [] : p.disks))], cell);
      const local = childBranches[i].disks;
      const slot = fit.wedges[i].hi - fit.wedges[i].lo + slotExtra;
      const fitsAt = (distance: number) => {
        const w = wedgeAt(local, distance, clear);
        if (!w || w.hi - w.lo > slot) return false;
        return carry(local, child.angle, distance, child.angle).every((d) => others.clear(d, BRANCH_GAP));
      };
      let inner = own + footprint.get(child.id)! + BRANCH_GAP;
      let outer = child.distance;
      if (inner >= outer) continue;
      if (fitsAt(inner)) outer = inner;
      else {
        for (let step = 0; step < 18 && outer - inner > 2; step++) {
          const mid = (inner + outer) / 2;
          if (fitsAt(mid)) outer = mid;
          else inner = mid;
        }
      }
      if (outer < child.distance) {
        let varied = child.distance - (child.distance - outer) * radialLooseness;
        // The safe set along a ray need not be perfectly continuous for a
        // hooked branch. Both endpoints are proven; if the interpolated point
        // is not, fall back to the nearer proven one.
        if (!fitsAt(varied)) varied = radialLooseness < 0.5 ? child.distance : outer;
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
  // The company faces `startAngle` — east by default — and everything grows
  // away from it from there.
  place(tree.rootId, { x: 0, y: 0 }, startAngle, false);

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
