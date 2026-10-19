/**
 * Neatening an arrangement without undoing it (Greg, 2026-09-30).
 *
 * *"Make it so the 'clean up' function actually just neatens up islands rather
 * than dragging everything back to the centre… one press of clean up makes the
 * islands neat — connection lines legible, only sibling chains clash, cousin
 * chains should not clash where possible — and de-clashes the central
 * spaghetti, potentially by rotating tiles by 60º or as needed. A connection
 * line should not emerge in one direction only to loop back on itself. An
 * additional press would pull the whole picture back to the compressed view."*
 *
 * So tidying has two stages, and only the second is the old behaviour of
 * throwing an arrangement away.
 *
 * ## What "neaten" is allowed to touch
 *
 * **Anything a person placed by hand stays exactly where they put it.** That is
 * the whole difference between this and the reset, and it is **Law 0** — the
 * hand outranks the engine. Every other unit is the layout's to move.
 *
 * (It used to cite the orbital engine's Law 3, which said the same thing about
 * authored placements. The hex map answers to `docs/MAP-LAWS.md` alone; see the
 * note at the top of `__tests__/hex.test.ts` for why the two sets must never be
 * mixed.)
 *
 * ## How
 *
 * On a hex lattice the natural move is a **rotation by a sixth of a turn about
 * a cell**. It keeps every unit on the grid, keeps a branch's internal shape
 * exactly as it was, and is the only transform that can change which way a
 * branch faces without changing what it looks like.
 *
 * So, top-down: for each unit, try its subtree in all six orientations about
 * that unit, throw away any that would land on somebody else, and keep the one
 * that points the branch furthest **away from where its own chain arrives**.
 * That is what stops a line leaving a parent and looping back on itself, which
 * is the thing that reads as spaghetti — and because the anchor never moves,
 * an island stays where it was put.
 *
 * Crossings are then counted before and after, so the caller can say whether it
 * actually helped rather than assuming it did.
 */
import type { OrbitalTree } from "@/lib/map/layout/model";
import { spacerRule } from "@/lib/map/layout/hex/spacing";
import {
  type Cell,
  type Point,
  axialRoute,
  cellKey,
  cellToWorld,
  hexDistance,
  neighbours,
  ring,
  rotateCell,
} from "@/lib/map/layout/hex/coords";

/**
 * **Moved to `coords.ts` on 2026-10-17**, where the rest of the lattice's own
 * geometry lives: the orderly chart a dragged branch turns into needs it too,
 * and a second engine importing it out of tidy would say that turning a shape
 * is tidy's business. Re-exported here because this is where it has been read
 * from since 2026-09-30.
 */
export { rotateCell } from "@/lib/map/layout/hex/coords";

const EPS = 1e-9;
const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do two segments properly cross? Segments that merely meet at an endpoint do
 *  not count — every child's chain meets its parent's, and that is the drawing
 *  working, not a clash. */
export function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  if (near(a1, b1) || near(a1, b2) || near(a2, b1) || near(a2, b2)) return false;
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  return (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  );
}

export type Chain = { unitId: string; parentId: string; points: Point[] };

/** Every chain in the picture, as the renderer draws it. */
export function chainsOf(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  size: number,
): Chain[] {
  const out: Chain[] = [];
  for (const unit of tree.units.values()) {
    if (!unit.parentId) continue;
    const here = cells.get(unit.id);
    const there = cells.get(unit.parentId);
    if (!here || !there) continue;
    out.push({ unitId: unit.id, parentId: unit.parentId, points: axialRoute(here, there, size) });
  }
  return out;
}

/**
 * How many pairs of chains cross, split by how closely related they are.
 *
 * Greg's bar: *"only sibling chains should clash; cousin chains should not
 * clash, where possible."* Two chains are siblings when they run to the same
 * parent — they are bound to converge, so a crossing there is the cost of a
 * family sitting together. Anything else is a cousin crossing, and those are
 * the ones that make a picture unreadable.
 */
export function countCrossings(chains: readonly Chain[]): { siblings: number; cousins: number } {
  let siblings = 0;
  let cousins = 0;
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const a = chains[i];
      const b = chains[j];
      let hit = false;
      for (let p = 0; p + 1 < a.points.length && !hit; p++) {
        for (let q = 0; q + 1 < b.points.length && !hit; q++) {
          if (segmentsCross(a.points[p], a.points[p + 1], b.points[q], b.points[q + 1])) hit = true;
        }
      }
      if (!hit) continue;
      if (a.parentId === b.parentId) siblings++;
      else cousins++;
    }
  }
  return { siblings, cousins };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** A branch's extent in cell coordinates, so the spacing check can throw away
 *  the strangers that are plainly nowhere near it before measuring anything. */
type Bounds = { minQ: number; maxQ: number; minR: number; maxR: number };

const boundsOf = (chain: Chain): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of chain.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

const overlaps = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

const chainsCross = (a: Chain, b: Chain): boolean => {
  for (let p = 0; p + 1 < a.points.length; p++) {
    for (let q = 0; q + 1 < b.points.length; q++) {
      if (segmentsCross(a.points[p], a.points[p + 1], b.points[q], b.points[q + 1])) return true;
    }
  }
  return false;
};

export type NeatenResult = {
  cells: Map<string, Cell>;
  /** How many branches travelled back to their family, and how many were
   *  turned to face the right way — with what it did to the crossings. */
  gathered: number;
  turned: number;
  before: { siblings: number; cousins: number };
  after: { siblings: number; cousins: number };
  /** How many gathered branches got all the clear ground the layout owed them,
   *  and how many had to settle for less because there was nowhere that did.
   *  A tidy that quietly stops spacing things is the fault this reports. */
  spaced: { full: number; squeezed: number };
};

/** Every unit at or below this one. */
function subtree(tree: OrbitalTree, id: string, out = new Set<string>()): Set<string> {
  if (out.has(id)) return out;
  out.add(id);
  for (const childId of tree.units.get(id)?.childIds ?? []) subtree(tree, childId, out);
  return out;
}

/**
 * Turn each branch to face away from where its own chain arrives, without
 * moving anything a person placed.
 *
 * `pinned` is the set of units somebody dragged. A branch is only turned when
 * the only pinned unit inside it is its own anchor — otherwise turning it would
 * move a placement that was chosen deliberately.
 */
export function neaten(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  pinned: ReadonlySet<string>,
  size: number,
  /**
   * **The clear ground the layout owes each unit** — `spacedBy` straight off
   * `layoutTerritories`, which is a share of the size of the territory it
   * separates.
   *
   * Law 4: *one measure of distance*. Tidy does not get a spacing rule of its
   * own; it is handed the layout's and honours it. Omit it and tidy packs
   * everything tight, which is what it did between 2026-10-14 and this
   * change — Greg: *"the auto-tidy works amazingly, but it doesn't provide any
   * space between peer groups… they bunch together with no space between
   * them."* He was right, and it was measurable: cells touching somebody from
   * another household went from **10% on a clean load to 69% after one
   * move-and-tidy**, and the company collapsed from 145×149 to 128×77.
   *
   * The cause was this file's gather phase, which seats a drifted branch on
   * the *nearest* free cell beside its family and had no notion that anything
   * else deserved room.
   */
  clearance?: ReadonlyMap<string, number>,
  /**
   * **Who is a human**, so tidy can obey the spacer rule.
   *
   * Greg, 2026-10-16: the rule applies *"on load, or using the auto-tidy
   * function."* Tidy had no notion of it and was measurably a second placer:
   * on a radial load with nought breaches, one tidy produced **14** on the
   * 45-person company and **245** on the 1,000-person one. Handing it the same
   * predicate the driver uses is Law 4's *one measure of distance* applied to
   * the rule that replaced the distances.
   *
   * Omit it and tidy behaves exactly as it did before, which is what the atlas
   * driver wants — it does not hold to this rule and never has.
   */
  people?: ReadonlySet<string>,
): NeatenResult {
  const placed = new Map(cells);
  /** The rule, or a rule that forbids nothing when tidy was not told who is a
   *  human — which is how the atlas driver's tidy behaves, unchanged. */
  const { mayTouch } = people
    // **Pinned units are exempt** — they are exactly the ones a hand put where
    // they are, and Greg's rule is that the hand outranks the spacer. Without
    // this a node somebody deliberately stood in a team's clear ground would go
    // on enforcing that ground against everybody else, which is the rule being
    // kept by the one unit that is allowed to break it.
    ? spacerRule(tree, people, { exempt: pinned })
    : { mayTouch: () => true };
  /**
   * **Law 3, which tidy also has to keep.**
   *
   * *"The engine may not place a team, or anything above a team, anywhere that
   * is not strictly further from the centre than its own parent."* Rotation is
   * what makes this tidy's problem and not only the driver's: a turn keeps a
   * branch's shape exactly, so nothing inside it moves relative to anything else
   * inside it, but **every member's distance from the master centre changes**.
   * Measured before this check existed, one tidy on a clean load reintroduced
   * 3 of 12 sideways rungs on the 45-person company and 7 of 164 on the
   * 1,000-person one.
   *
   * Only places are held to it, as in the driver — a person is pushed outward,
   * never forbidden.
   */
  const CENTRE: Cell = { q: 0, r: 0 };
  const climbs = (landing: ReadonlyMap<string, Cell>): boolean => {
    if (!people) return true;
    for (const [id, at] of landing) {
      if (people.has(id)) continue;
      const parentId = tree.units.get(id)?.parentId;
      if (!parentId) continue;
      const parentAt = landing.get(parentId) ?? placed.get(parentId);
      if (!parentAt) continue;
      if (hexDistance(at, CENTRE) <= hexDistance(parentAt, CENTRE)) return false;
    }
    return true;
  };

  /** cell key → who is standing there, kept in step as the gather moves things. */
  const occupantAt = new Map<string, string>();
  for (const [id, cell] of placed) occupantAt.set(cellKey(cell), id);
  let gathered = 0;
  let fullySpaced = 0;
  let squeezed = 0;

  /**
   * Who a unit is *not* required to keep its distance from: itself, its own
   * subtree, and its line of ancestors.
   *
   * A child belongs inside its parent's ground and may sit against it — that is
   * Law 2, a body stays whole. The gap is between *bodies*, so a sibling's
   * subtree, a cousin's, and anybody else's are all strangers to be spaced
   * from. Without this distinction the rule would forbid a branch from ever
   * reaching its own parent and nothing could be gathered at all.
   */
  const ancestorsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    let up = tree.units.get(id)?.parentId ?? null;
    while (up) { out.add(up); up = tree.units.get(up)?.parentId ?? null; }
    return out;
  };
  let allChains = chainsOf(tree, placed, size);
  const before = countCrossings(allChains);
  let turned = 0;

  // --- phase one: gather the stragglers ------------------------------------
  //
  // Turning a branch can only change which way it faces, never how far away it
  // is, and a chain that runs half the company is unreadable whichever way it
  // points. So first: any branch that has drifted off its family — and that
  // nobody placed there on purpose — travels back to its family's own edge,
  // carrying its shape with it.
  //
  // This is the allocator's rule applied locally, and it is what "makes the
  // islands neat" actually means: a division's teams gather round the division
  // rather than trailing across the map to it.
  {
    const order = [...tree.units.values()]
      .filter((u) => u.parentId)
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

    for (const unit of order) {
      if (pinned.has(unit.id)) continue;
      const here = placed.get(unit.id);
      const home = unit.parentId ? placed.get(unit.parentId) : null;
      if (!here || !home) continue;

      const mine = subtree(tree, unit.id);
      if ([...mine].some((id) => pinned.has(id))) continue; // a hand is in there

      const taken = new Map<string, string>();
      for (const [id, cell] of placed) if (!mine.has(id)) taken.set(cellKey(cell), id);

      // The family's ground: the parent and whichever siblings are already
      // sitting against it.
      const family: Cell[] = [home];
      for (const siblingId of tree.units.get(unit.parentId!)?.childIds ?? []) {
        if (siblingId === unit.id) continue;
        const cell = placed.get(siblingId);
        if (cell && hexDistance(cell, home) <= 1) family.push(cell);
      }

      // What the layout would have left clear round this unit, and who has to
      // stay outside it.
      const owed = clearance?.get(unit.id) ?? 0;
      const kin = ancestorsOf(unit.id);
      const strangers: Cell[] = [];
      if (owed > 0) {
        for (const [id, cell] of placed) {
          if (mine.has(id) || kin.has(id)) continue;
          strangers.push(cell);
        }
      }

      /**
       * The clear ground this landing would actually achieve, never more than
       * what is owed — so a branch is not rewarded for drifting into the
       * wilderness, only for not pressing against the neighbours.
       */
      const clearanceOf = (branchCells: Set<string>, box: Bounds): number => {
        if (owed <= 0) return 0;
        let worst = owed;
        for (const s of strangers) {
          if (s.q < box.minQ - owed || s.q > box.maxQ + owed) continue;
          if (s.r < box.minR - owed || s.r > box.maxR + owed) continue;
          for (let r = 0; r <= worst; r++) {
            const shell = r === 0 ? [s] : ring(s, r);
            let hit = false;
            for (const c of shell) if (branchCells.has(cellKey(c))) { hit = true; break; }
            if (hit) { worst = Math.max(0, r - 1); break; }
          }
          if (worst === 0) break;
        }
        return worst;
      };

      /**
       * **A branch sits against its family. Full stop.**
       *
       * Law 2 outranks Law 4, and this is where that ranking earns its keep.
       * Letting a branch move out to the rings where its owed gap *is*
       * available halves the bunching — 70% of cells touching a stranger down
       * to 40% — and costs branch integrity: whole branches fall from 47 of 58
       * to 31. Measured 2026-10-14 on the 1,000-person company, and it is the
       * other half of what Greg reported in the same breath as the bunching:
       * *"they do tend to split in some cases."*
       *
       * So the candidates stay what they were — the cells touching this
       * branch's own family — and the room comes from choosing *which* of them,
       * and from the turn below, which cannot break a branch because it moves
       * the whole thing at once.
       */
      const options: Cell[] = family.flatMap((member) => neighbours(member));

      // Leaving it alone is always on the table, and wins ties: churn in an
      // arrangement somebody is looking at is its own cost.
      let target: Cell | null = null;
      let bestD = hexDistance(home, here);
      let bestClear = -1;
      const seen = new Set<string>();
      {
        const own = new Set<string>();
        const box: Bounds = {
          minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity,
        };
        for (const id of mine) {
          const at = placed.get(id);
          if (!at) continue;
          own.add(cellKey(at));
          box.minQ = Math.min(box.minQ, at.q); box.maxQ = Math.max(box.maxQ, at.q);
          box.minR = Math.min(box.minR, at.r); box.maxR = Math.max(box.maxR, at.r);
        }
        bestClear = clearanceOf(own, box);
      }

      for (const candidate of options) {
        {
          const key = cellKey(candidate);
          if (seen.has(key) || taken.has(key)) continue;
          seen.add(key);
          // Every cell the branch would need has to be free as well.
          let fits = true;
          const branchCells = new Set<string>();
          const box: Bounds = {
            minQ: Infinity, maxQ: -Infinity, minR: Infinity, maxR: -Infinity,
          };
          /** Where each of the branch's units would stand, so the spacer can be
           *  checked against whoever is already next to that cell. */
          const landing: [string, Cell][] = [];
          for (const id of mine) {
            const from = placed.get(id);
            if (!from) continue;
            const to = {
              q: from.q - here.q + candidate.q,
              r: from.r - here.r + candidate.r,
            };
            if (taken.has(cellKey(to))) { fits = false; break; }
            landing.push([id, to]);
            branchCells.add(cellKey(to));
            box.minQ = Math.min(box.minQ, to.q); box.maxQ = Math.max(box.maxQ, to.q);
            box.minR = Math.min(box.minR, to.r); box.maxR = Math.max(box.maxR, to.r);
          }
          if (!fits) continue;

          /**
           * **Nobody lands in somebody else's spacer.** Checked for the whole
           * branch at once, because a branch travels as one body — Law 2 — so a
           * landing that would put one of its people against a stranger is not
           * a landing, however well the rest of it fits.
           */
          if (people) {
            let breaches = false;
            for (const [id, at] of landing) {
              for (const near of neighbours(at)) {
                const key = cellKey(near);
                if (branchCells.has(key)) continue;
                const sitting = occupantAt.get(key);
                if (sitting !== undefined && !mine.has(sitting) && !mayTouch(id, sitting)) {
                  breaches = true;
                  break;
                }
              }
              if (breaches) break;
            }
            if (breaches) continue;
          }

          // Law 3: every place in the branch must still climb where it lands.
          if (people && !climbs(new Map(landing))) continue;

          // **Room first, then nearness.** The old rule was nearness alone,
          // and nearness alone is what packs a map solid: every branch takes
          // the first free cell against its family, so every boundary on the
          // map becomes one tile wide and stops meaning anything.
          const clear = clearanceOf(branchCells, box);
          const d = hexDistance(home, candidate);
          if (clear > bestClear || (clear === bestClear && d < bestD)) {
            bestClear = clear; bestD = d; target = candidate;
          }
        }
      }
      if (owed > 0) { if (bestClear >= owed) fullySpaced++; else squeezed++; }
      if (!target) continue;

      for (const id of mine) {
        const from = placed.get(id);
        if (!from) continue;
        occupantAt.delete(cellKey(from));
        const to = { q: from.q - here.q + target.q, r: from.r - here.r + target.r };
        placed.set(id, to);
        occupantAt.set(cellKey(to), id);
      }
      gathered++;
    }
    allChains = chainsOf(tree, placed, size);
  }

  // --- phase two: turn each branch to face the right way --------------------
  //
  // Top-down: a parent settles which way it faces before its children do, so a
  // child is turning against ground that has stopped moving.
  /**
   * **Retired where the master centre decides which way is out** (2026-10-17).
   *
   * This phase turns each branch to face away from *where its own chain
   * arrives* — a rigid rotation about the branch's anchor, by sixths of a turn.
   * It was the best available answer while a branch's shape was its own
   * business. It is not any more: since the absolute arcs landed, which way a
   * unit faces is its share of the master centre's circle, and a picked-up
   * branch defers to the master centre by distance (`defer.ts`). A rigid turn
   * applied on top of either is a second opinion about the same question, and
   * it is the weaker one — it cannot see the centre at all.
   *
   * Measured on Northwind with people as the smallest unit, one tidy on a clean
   * radial load:
   *
   * | | turning | not turning |
   * | --- | ---: | ---: |
   * | tidy takes | 6,855ms | **1,177ms** |
   * | branches turned | 401 | 0 |
   * | spacer breaches | 4 | **0** |
   * | teams in one piece | 389/395 | **392/395** |
   * | chain crossings | 149 → **124** | 149 → 138 |
   *
   * So it buys 14 crossings of the 149 and costs four breaches of Law 4, three
   * bodies under Law 2 and **5.8× the time**. Law 5 is ranked last for exactly
   * this kind of trade: *lines follow, they never lead.*
   *
   * **The atlas keeps it**, unchanged. It has no ring floors, no absolute arcs
   * and nothing to defer to, so for that driver this phase is still the only
   * thing that points a branch anywhere — and `people` being handed in is
   * precisely the signal that the radial driver laid this map.
   */
  const order = people ? [] : [...tree.units.values()]
    .filter((u) => u.childIds.length > 0 && u.parentId)
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  for (const unit of order) {
    const anchor = placed.get(unit.id);
    const home = unit.parentId ? placed.get(unit.parentId) : null;
    if (!anchor || !home) continue;

    const members = [...subtree(tree, unit.id)].filter((id) => id !== unit.id);
    if (members.length === 0) continue;
    if (members.some((id) => pinned.has(id))) continue; // a hand is in there

    // Where everyone else is, so a turn cannot land on them.
    const mine = new Set([unit.id, ...members]);
    const taken = new Map<string, string>();
    for (const [id, cell] of placed) if (!mine.has(id)) taken.set(cellKey(cell), id);

    const homeWorld = cellToWorld(home, size);
    const anchorWorld = cellToWorld(anchor, size);
    // The direction the chain arrives from, normalised.
    const inX = anchorWorld.x - homeWorld.x;
    const inY = anchorWorld.y - homeWorld.y;
    const inLen = Math.hypot(inX, inY) || 1;

    // The chains this turn cannot affect: everything with neither end inside
    // the branch. They are the wall the branch is being fitted against, and a
    // bounding box keeps the comparison to the ones actually nearby.
    const outside = allChains.filter((c) => !mine.has(c.unitId) && !mine.has(c.parentId));

    let bestSteps = 0;
    let bestScore = -Infinity;
    for (let steps = 0; steps < 6; steps++) {
      let blocked = false;
      let outward = 0;
      const seen = new Set<string>();
      for (const id of members) {
        const from = placed.get(id);
        if (!from) continue;
        const to = rotateCell(from, anchor, steps);
        const key = cellKey(to);
        if (taken.has(key) || seen.has(key)) { blocked = true; break; }
        seen.add(key);
        const w = cellToWorld(to, size);
        const dx = w.x - anchorWorld.x;
        const dy = w.y - anchorWorld.y;
        const len = Math.hypot(dx, dy) || 1;
        // How far this member lies in the direction the branch was already
        // heading. Weighted toward the near members, which are the ones whose
        // chains would visibly double back.
        outward += ((dx * inX + dy * inY) / (len * inLen)) / Math.max(1, hexDistance(anchor, to));
      }
      if (blocked) continue;

      /**
       * **A turn that breaches somebody's spacer is not on offer.**
       *
       * Rotation keeps a branch's own shape exactly, so nothing inside it can
       * break the rule — but it changes which way the branch faces the world,
       * and that is where it meets strangers. Checking the gather alone took one
       * tidy on the 1,000-person company from 245 breaches to 94; the remaining
       * 94 were all turns.
       */
      if (people) {
        const landed = new Map<string, string>();
        for (const id of members) {
          const from = placed.get(id);
          if (from) landed.set(cellKey(rotateCell(from, anchor, steps)), id);
        }
        let breaches = false;
        for (const [key, id] of landed) {
          const [q, r] = key.split(",").map(Number);
          for (const near of neighbours({ q, r })) {
            const nearKey = cellKey(near);
            if (landed.has(nearKey)) continue;
            const sitting = occupantAt.get(nearKey);
            if (sitting !== undefined && !mine.has(sitting) && !mayTouch(id, sitting)) {
              breaches = true;
              break;
            }
          }
          if (breaches) break;
        }
        if (breaches) continue;
      }

      // Law 3 again, and this is the phase that needed it most: a rotation
      // changes every member's distance from the centre.
      if (people) {
        const turned = new Map<string, Cell>();
        for (const id of members) {
          const from = placed.get(id);
          if (from) turned.set(id, rotateCell(from, anchor, steps));
        }
        if (!climbs(turned)) continue;
      }

      // What this turn would actually cost in clashes. Only the branch's own
      // chains are recounted — the ones between two units outside it cannot
      // move — and its internal chains keep their shape under a rotation, so
      // the only pairs that change are branch-against-world.
      const turnedCells = new Map(placed);
      for (const id of members) {
        const from = placed.get(id);
        if (from) turnedCells.set(id, rotateCell(from, anchor, steps));
      }
      const branchChains = chainsOf(tree, turnedCells, size)
        .filter((c) => mine.has(c.unitId) || mine.has(c.parentId));
      let siblingHits = 0;
      let cousinHits = 0;
      for (const a of branchChains) {
        const ab = boundsOf(a);
        for (const b of outside) {
          if (!overlaps(ab, boundsOf(b))) continue;
          if (!chainsCross(a, b)) continue;
          if (a.parentId === b.parentId) siblingHits++;
          else cousinHits++;
        }
      }

      /**
       * **This breaks Law 5, and it is the only place that does.**
       *
       * `docs/MAP-LAWS.md`: *"The engine may not move a unit to improve a
       * line."* No exception clause. Here the dominant term is exactly that —
       * the crossings a rotation would cause, cousins weighted ten to one —
       * and facing the right way is the tie-break under it.
       *
       * It is marked rather than fixed because removing it is not a one-line
       * change and the measurements do not yet say what replaces it: on the
       * recovered gesture this phase *improves* cohesion markedly (children
       * touching their family 86.4% → 91.5%). The law predicts the price
       * anyway — *"on a small branch there are few chains and the territory
       * wins; on a big one the crossing count outvotes it"* — which is the
       * shape of what Greg reports on large companies and not on small ones.
       *
       * Cousins are what Greg asked to clear; siblings are allowed to converge
       * on their shared parent and cost a tenth as much. A tie goes to leaving
       * the branch alone — turning one that gains nothing is churn, and churn
       * in a hand-made arrangement is its own cost.
       */
      const score =
        -(cousinHits * 10 + siblingHits) + outward * 0.5 + (steps === 0 ? 1e-6 : 0);
      if (score > bestScore) { bestScore = score; bestSteps = steps; }
    }

    if (bestSteps === 0) continue;
    for (const id of members) {
      const from = placed.get(id);
      if (!from) continue;
      occupantAt.delete(cellKey(from));
      const to = rotateCell(from, anchor, bestSteps);
      placed.set(id, to);
      occupantAt.set(cellKey(to), id);
    }
    allChains = chainsOf(tree, placed, size);
    turned++;
  }

  return {
    cells: placed,
    turned,
    gathered,
    before,
    after: countCrossings(chainsOf(tree, placed, size)),
    spaced: { full: fullySpaced, squeezed },
  };
}
