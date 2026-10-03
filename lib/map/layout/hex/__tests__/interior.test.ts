/**
 * A team laid out on its own ground, without the rest of the company in the
 * room (2026-10-03).
 *
 * Greg: *"only load team contents when the zoom level approaches them. Load and
 * manage the team area for sure, but don't pull all the data about every human
 * on load."*
 *
 * The rules a team's inside has to keep are the engine's own, one scale down:
 * the team is one patch, it grows away from the way home, and nobody stands on
 * anybody. What is new is that it has to hold **without reference to anything
 * outside the region** — which is the property that lets it be computed when
 * the camera arrives, cached, and thrown away again.
 */
import { describe, expect, it } from "vitest";
import { layoutInterior, interiorCapacity, type InteriorMember } from "@/lib/map/layout/hex/interior";
import { regionRadius, type Region } from "@/lib/map/layout/hex/allocate";
import { cellKey, hexDistance, neighbours, type Cell } from "@/lib/map/layout/hex/coords";

/**
 * A team of `n` people under a lead, shaped the way `buildDeepOrg` shapes one:
 * a random manager among those with room, spans of two to five. Real teams are
 * ragged, and raggedness turns out to matter — see the balanced case below.
 */
function team(n: number, seed = 7): InteriorMember[] {
  let state = seed;
  const rng = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const out: InteriorMember[] = [{ id: "p0", parentId: "team" }];
  const room = new Map<string, number>([["p0", 0]]);
  for (let i = 1; i < n; i++) {
    const cap = 2 + Math.floor(rng() * 4);
    const free = out.filter((m) => (room.get(m.id) ?? 0) < cap);
    const boss = free.length > 0 ? free[Math.floor(rng() * free.length)].id : "p0";
    out.push({ id: `p${i}`, parentId: boss });
    room.set(boss, (room.get(boss) ?? 0) + 1);
    room.set(`p${i}`, 0);
  }
  return out;
}

/** Every manager given exactly `span` reports — the hard case, and the one
 *  worth a test of its own. */
function balanced(n: number, span: number): InteriorMember[] {
  const out: InteriorMember[] = [{ id: "p0", parentId: "team" }];
  const room = new Map<string, number>([["p0", 0]]);
  for (let i = 1; i < n; i++) {
    const boss = out.map((m) => m.id).find((id) => (room.get(id) ?? 0) < span) ?? "p0";
    out.push({ id: `p${i}`, parentId: boss });
    room.set(boss, (room.get(boss) ?? 0) + 1);
    room.set(`p${i}`, 0);
  }
  return out;
}

/** The ground a team of this size would be given, and the seat on its near
 *  edge — the same arithmetic `claimRegion` uses. */
function ground(n: number, from: Cell = { q: -10, r: 0 }) {
  const radius = regionRadius(Math.ceil((n + 1) * 1.35));
  const region: Region = { centre: { q: 0, r: 0 }, radius };
  let seat = region.centre;
  let nearest = Infinity;
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const cell = { q, r };
      if (hexDistance(cell, region.centre) > radius) continue;
      const d = hexDistance(cell, from);
      if (d < nearest) { nearest = d; seat = cell; }
    }
  }
  return { region, seat, from };
}

const lay = (n: number, members = team(n)) => {
  const { region, seat, from } = ground(n);
  const homeAngle = Math.atan2(from.r - seat.r, from.q - seat.q);
  return {
    ...layoutInterior({ teamId: "team", seat, region, homeAngle, members }),
    region, seat, from, members,
  };
};

/** How many members sit next to the manager they report to. */
const beside = (laid: ReturnType<typeof lay>): number => {
  let next = 0;
  for (const m of laid.members) {
    const mine = laid.cells.get(m.id);
    const theirs = m.parentId === "team" ? laid.seat : laid.cells.get(m.parentId);
    if (mine && theirs && hexDistance(mine, theirs) === 1) next++;
  }
  return next / laid.members.length;
};

describe("a team on its own ground", () => {
  it("seats everybody, and nobody twice", () => {
    for (const n of [1, 3, 7, 20, 50]) {
      const { cells, spilled } = lay(n);
      expect(spilled).toEqual([]);
      expect(cells.size).toBe(n);
      expect(new Set([...cells.values()].map(cellKey)).size).toBe(n);
    }
  });

  it("never stands anyone on the team's own cell", () => {
    for (const n of [3, 20, 50]) {
      const { cells, seat } = lay(n);
      for (const cell of cells.values()) expect(cellKey(cell)).not.toBe(cellKey(seat));
    }
  });

  /** The region is a promise to every other team on the map. Breaking out of
   *  it is the one failure that shows up as somebody else's problem. */
  it("never puts anyone outside the region it was given", () => {
    for (const n of [3, 20, 50]) {
      const { cells, region } = lay(n);
      for (const cell of cells.values()) {
        expect(hexDistance(cell, region.centre)).toBeLessThanOrEqual(region.radius);
      }
    }
  });

  /** Rule 1, one scale down: a member takes a cell on the edge of its own
   *  family, so the team is a blob rather than a scatter. */
  it("keeps the team one connected patch", () => {
    for (const n of [3, 7, 20, 50]) {
      const { cells, seat } = lay(n);
      const patch = new Set([cellKey(seat), ...[...cells.values()].map(cellKey)]);
      const seen = new Set([cellKey(seat)]);
      const queue: Cell[] = [seat];
      while (queue.length) {
        const at = queue.pop()!;
        for (const n2 of neighbours(at)) {
          const key = cellKey(n2);
          if (patch.has(key) && !seen.has(key)) { seen.add(key); queue.push(n2); }
        }
      }
      expect(seen.size).toBe(patch.size);
    }
  });

  it("puts people next to the manager they report to", () => {
    // Small and middling teams are exact; the fifty-person case is the one
    // Greg asked to see and it holds at 84%.
    expect(beside(lay(7))).toBe(1);
    expect(beside(lay(20))).toBe(1);
    expect(beside(lay(50))).toBeGreaterThan(0.8);
  });

  /**
   * **A perfectly balanced tree is the hard case, and it is the lattice's
   * doing rather than this module's.**
   *
   * Give every manager exactly five reports and adjacency falls to 36% at
   * fifty people. That is not confinement: handed the whole infinite plane and
   * no region to stay inside, the global allocator manages 48% on the same
   * shape. A hex cell has six neighbours and one is the way home, so a uniform
   * span of five asks every single node for all the room it has, all at the
   * same depth, and a ragged tree's slack is what usually absorbs it.
   *
   * Staying inside a region costs about twelve points on top of that. Worth
   * knowing before anybody reads a low number here as a regression — and worth
   * revisiting with `REGION_SLACK` if real companies turn out to be this
   * uniform, which would be a decision about how much ground the whole map
   * spends, not a tuning job.
   */
  it("is beaten by a uniform wide span, as the plane itself is", () => {
    expect(beside(lay(50, balanced(50, 5)))).toBeGreaterThan(0.3);
    expect(beside(lay(50, balanced(50, 3)))).toBeGreaterThan(0.5);
    // Still one patch, still inside the region, however ragged the adjacency.
    const laid = lay(50, balanced(50, 5));
    expect(laid.spilled).toEqual([]);
    for (const cell of laid.cells.values()) {
      expect(hexDistance(cell, laid.region.centre)).toBeLessThanOrEqual(laid.region.radius);
    }
  });

  /** Greg's rotation rule, inherited: the chain home arrives at the near edge
   *  and the tree runs inward, so the team does not grow back over its own
   *  connection. */
  it("grows away from the way home, not back along it", () => {
    const laid = lay(20);
    const away = { q: laid.seat.q - laid.from.q, r: laid.seat.r - laid.from.r };
    let ahead = 0;
    for (const cell of laid.cells.values()) {
      const step = { q: cell.q - laid.seat.q, r: cell.r - laid.seat.r };
      if (step.q * away.q + step.r * away.r >= 0) ahead++;
    }
    expect(ahead / laid.cells.size).toBeGreaterThan(0.75);
  });

  /** The ground and the seat are fixed by the region; what `homeAngle` decides
   *  is which way the tree runs across them. It must actually be read. */
  it("lays the tree out differently when the way home changes", () => {
    const { region, seat } = ground(12);
    const members = team(12);
    const at = (homeAngle: number) =>
      [...layoutInterior({ teamId: "team", seat, region, homeAngle, members }).cells]
        .map(([id, c]) => `${id}@${cellKey(c)}`).join(" ");
    expect(at(0)).not.toBe(at(Math.PI));
  });

  /** Law 1 at team scale, and the whole reason this is safe to cache. */
  it("gives the same answer every time, and never consults anything outside", () => {
    const { region, seat } = ground(30);
    const members = team(30);
    const once = layoutInterior({ teamId: "team", seat, region, homeAngle: 1, members });
    const again = layoutInterior({ teamId: "team", seat, region, homeAngle: 1, members });
    expect([...again.cells]).toEqual([...once.cells]);
    // Shuffled input, same answer: order of arrival must not matter.
    const shuffled = [...members].reverse();
    const reversed = layoutInterior({ teamId: "team", seat, region, homeAngle: 1, members: shuffled });
    expect([...reversed.cells].sort()).toEqual([...once.cells].sort());
  });

  /**
   * Running out of ground is a real event — a team grown past its reservation
   * — and the honest answer is to say who was left out. Drawing them on the
   * neighbour's ground is the one thing a reserved region must never do.
   */
  it("leaves people out rather than spilling onto somebody else's ground", () => {
    const region: Region = { centre: { q: 0, r: 0 }, radius: 1 };
    const seat = { q: 1, r: 0 };
    const members = team(20);
    const out = layoutInterior({ teamId: "team", seat, region, homeAngle: Math.PI, members });
    expect(out.cells.size).toBe(interiorCapacity(region));
    expect(out.spilled.length).toBe(20 - out.cells.size);
    for (const cell of out.cells.values()) {
      expect(hexDistance(cell, region.centre)).toBeLessThanOrEqual(1);
    }
  });

  it("has nothing to say about a team with no people", () => {
    const { region, seat } = ground(1);
    const out = layoutInterior({ teamId: "team", seat, region, homeAngle: 0, members: [] });
    expect(out.cells.size).toBe(0);
    expect(out.spilled).toEqual([]);
  });
});
