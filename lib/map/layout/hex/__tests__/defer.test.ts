/**
 * **Deference — one dial from "as the master centre would have it" to "an
 * orderly chart of its own".**
 *
 * Greg, 2026-10-17: *"master-centre should be the only node that drives the
 * radial distance behaviour. Once a node is picked up and moved, it should not
 * become its own master-centre… the further away from master-centre the user
 * moves it, the less it observes the layout behaviour defined by master-centre."*
 *
 * Three of the blocks here came off `arrange.test.ts`, where they tested the
 * `radiateFrom` path that this replaces: Greg's *"radiating"* rule of
 * 2026-10-02, Law 4 read from both sides of a hand-placed branch, and Law 2 on a
 * real company after a tidy. The mechanism changed; the properties did not, and
 * they are checked here on the deep company rather than on a hand-built map of
 * three cells.
 */
import { describe, expect, it } from "vitest";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { allocateByTerritory } from "@/lib/map/layout/hex/territory";
import { deferBranch } from "@/lib/map/layout/hex/defer";
import { leastApart, spacerRule } from "@/lib/map/layout/hex/spacing";
import { cellKey, hexDistance, neighbours, type Cell } from "@/lib/map/layout/hex/coords";

const ORIGIN: Cell = { q: 0, r: 0 };

const treeOf = (people: number, maxDepth: number): OrbitalTree => {
  const org = buildDeepOrg("hexlab", { people, maxDepth, seed: 7 });
  return buildOrbitalTree(
    {
      units: org.units.map((u) => ({
        id: u.id, name: u.name, parentId: u.parentId ?? null,
        leadPersonId: u.leadPersonId ?? null,
      })),
      people: org.people.map((p) => ({ id: p.id, name: p.name })),
      assignments: org.assignments.map((a) => ({
        personId: a.personId, orgUnitId: a.orgUnitId, allocationPct: a.allocationPct ?? 100,
      })),
    },
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
};

/** A company, laid out as the lab lays it out, with a branch worth dragging. */
const company = (people = 1000, depth = 8) => {
  const tree = treeOf(people, depth);
  const crowd = new Set(
    [...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id),
  );
  const laid = allocateByTerritory(tree, { people: crowd, driver: "radial", sideways: "forbid" });
  const anchor = [...tree.units.values()]
    .filter((u) => u.parentId && u.childIds.length > 1 && laid.cells.has(u.id))
    .sort((a, b) => b.totalSeats - a.totalSeats)[0];
  const floors = laid.floors ?? [];
  const belongs = floors[Math.min(anchor.depth, floors.length - 1)] ?? 1;
  return { tree, crowd, laid, anchor, floors, belongs };
};

/** Drop `anchor` this many times its own rung's floor from the centre, along
 *  the bearing it already sits on. */
const dropAt = (c: ReturnType<typeof company>, factor: number) => {
  const home = c.laid.cells.get(c.anchor.id)!;
  const out = Math.max(1, Math.round(c.belongs * factor));
  const scale = out / Math.max(1, hexDistance(home, ORIGIN));
  const hand: Cell = { q: Math.round(home.q * scale), r: Math.round(home.r * scale) };
  const laid = deferBranch({
    tree: c.tree, anchorId: c.anchor.id, hand,
    calculated: c.laid.cells, occupants: c.laid.occupants,
    floors: c.floors, tier: c.laid.tier, people: c.crowd,
  });
  /** The whole map with the branch where the hand left it. */
  const after = new Map(c.laid.cells);
  for (const [id, cell] of laid.cells) after.set(id, cell);
  return { ...laid, hand, after };
};

describe("the dial", () => {
  const c = company();

  it("defers completely when the node is put back where its rung belongs", () => {
    expect(dropAt(c, 1).deference).toBe(1);
    expect(dropAt(c, 0.5).deference).toBe(1);
  });

  it("falls off with how far the hand took it, and never reaches nothing", () => {
    const out = [1, 2, 4, 8].map((f) => dropAt(c, f).deference);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeLessThan(out[i - 1]);
    expect(out.at(-1)!).toBeGreaterThan(0);
    // Half the distance, half the deference: the dial is the ratio of two radii
    // and nothing else, which is what makes it need no tuning.
    expect(dropAt(c, 2).deference).toBeCloseTo(0.5, 1);
    expect(dropAt(c, 4).deference).toBeCloseTo(0.25, 1);
  });

  it("is the same answer every time, for the same hand", () => {
    const once = dropAt(c, 3);
    const again = dropAt(c, 3);
    for (const [id, cell] of once.cells) expect(again.cells.get(id)).toEqual(cell);
  });
});

describe("Law 0 — the hand outranks the engine", () => {
  const c = company();

  it("leaves the node on the very cell the hand let go of", () => {
    let held = 0;
    for (const factor of [0.5, 1, 2, 4, 8]) {
      const laid = dropAt(c, factor);
      if (laid.held) {
        held++;
        expect(laid.cells.get(c.anchor.id)).toEqual(laid.hand);
      } else {
        // The only reason it may not be honoured, and it has to be a real one:
        // somebody who is not moving was already standing there.
        expect(c.laid.occupants.get(cellKey(laid.hand))).toBeTruthy();
      }
    }
    // One of these drops happens to land on a resident of the map, which is
    // the Law 1 interlock doing its job rather than a hole in the test.
    expect(held).toBeGreaterThanOrEqual(4);
  });

  it("gives way only to Law 1, when somebody who is not moving is already there", () => {
    /**
     * Law 0's own interlock: *"a hand placement only becomes a placement if it
     * satisfied Law 1 at the moment it was made."* So the one reason the hand's
     * cell is not honoured is that it is taken — and the caller is told, rather
     * than two units ending up on one cell.
     */
    const stranger = [...c.laid.cells.entries()]
      .find(([id]) => id !== c.anchor.id && !isUnder(c.tree, c.anchor.id, id))!;
    const laid = deferBranch({
      tree: c.tree, anchorId: c.anchor.id, hand: stranger[1],
      calculated: c.laid.cells, occupants: c.laid.occupants,
      floors: c.floors, tier: c.laid.tier, people: c.crowd,
    });
    expect(laid.held).toBe(false);
    expect(laid.cells.get(c.anchor.id)).not.toEqual(stranger[1]);
  });
});

describe("Law 1 — one cell, one unit, and nobody left without one", () => {
  it.each([[1000, 8], [45, 4], [120, 5]])(
    "seats every unit of the branch on its own cell (%i people)",
    (people, depth) => {
      const c = company(people, depth);
      const under = [...c.tree.units.keys()].filter((id) => isUnder(c.tree, c.anchor.id, id));
      for (const factor of [0.5, 1, 2, 4, 8]) {
        const laid = dropAt(c, factor);
        // Everybody in the branch, including the anchor.
        expect(laid.cells.size).toBe(under.length + 1);
        const seen = new Set<string>();
        for (const cell of laid.after.values()) {
          const key = cellKey(cell);
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    },
  );
});

describe("Law 2 — a body stays whole", () => {
  /**
   * Greg, 2026-10-14, of the gesture this replaces: *"when moving a medium
   * cluster, occasionally one node will get flung out, or we'll end up with
   * something that looks like digital spaghetti in the connection lines."*
   *
   * **A team and its own crowd blend as one body**, which is what holds this.
   * The first cut took the taper off each unit's own depth, so a team five rungs
   * below the hand was pulled back 65% of the way while its own people — one
   * rung deeper — were pulled 78%, and the crowd came off its node: teams in one
   * piece fell to **222 of 395** at the chart end. Weighting the crowd with its
   * team took it back to 368, and to 395 at full deference.
   */
  it.each([0.5, 1, 2, 4, 8])("keeps teams in one piece at every setting (× %s)", (factor) => {
    const c = company();
    const laid = dropAt(c, factor);
    const { teamFor } = spacerRule(c.tree, c.crowd);
    const members = new Map<string, string[]>();
    for (const id of c.crowd) {
      const team = teamFor(id);
      if (!team) continue;
      const had = members.get(team);
      if (had) had.push(id); else members.set(team, [id]);
    }
    let teams = 0;
    let whole = 0;
    for (const [team, crowd] of members) {
      const own = laid.after.get(team);
      if (!own) continue;
      teams++;
      const patch = new Set([cellKey(own)]);
      for (const id of crowd) {
        const cell = laid.after.get(id);
        if (cell) patch.add(cellKey(cell));
      }
      const seen = new Set([cellKey(own)]);
      const stack: Cell[] = [own];
      while (stack.length) {
        const at = stack.pop()!;
        for (const near of neighbours(at)) {
          const key = cellKey(near);
          if (patch.has(key) && !seen.has(key)) { seen.add(key); stack.push(near); }
        }
      }
      if (seen.size === patch.size) whole++;
    }
    expect(teams).toBeGreaterThan(20);
    /**
     * **The cost is in the middle of the dial, and it is small.** Measured on
     * this company, whose clean load is 48 of 48 teams in one piece:
     *
     * | deference | teams in one piece |
     * | --- | ---: |
     * | 1.00 (put back inside its rung) | **48/48** |
     * | 0.65 | 41/48 |
     * | 0.50 | 43/48 |
     * | 0.33 | 47/48 |
     * | 0.25 and below (a chart) | **48/48** |
     *
     * Both ends are exact and the middle costs up to seven teams, because a
     * body aimed halfway between its chart place and its home one meets bodies
     * aimed from the other end of the branch in the same ground. Aiming tidy at
     * the branch puts them back. Asserted as a bound rather than a figure so a
     * real regression fails and a tuning change does not.
     */
    expect(whole / teams).toBeGreaterThan(0.85);
  });
});

describe("Law 4 — the gap is one measure, read from both sides", () => {
  /**
   * Greg, 2026-10-14, of the gesture this replaces: *"the 5s placement feature
   * bunches peer groups together — it does not observe any spacing rules."*
   *
   * It observes one rule, `leastApart` from `spacing.ts`, and this is the test
   * that came off `arrange.test.ts` with the path it used to check. **The node
   * in the hand is exempt and must be**, because Law 0 is above Law 4: where a
   * hand puts something is not the engine's business to improve, so a node
   * dropped against a stranger keeps its cell and the breach is counted rather
   * than corrected.
   */
  it.each([0.5, 1, 2, 4, 8])("puts nobody in a stranger's clear ground (× %s)", (factor) => {
    const c = company();
    const laid = dropAt(c, factor);
    const { mayTouch } = spacerRule(c.tree, c.crowd);
    const tierOf = (id: string) => c.laid.tier?.get(id) ?? 0;
    const at = new Map<string, string>();
    for (const [id, cell] of laid.after) at.set(cellKey(cell), id);

    for (const [id, cell] of laid.cells) {
      if (id === c.anchor.id) continue; // Law 0, above this law.
      for (const [other, there] of laid.after) {
        if (other === id || other === c.anchor.id) continue;
        const apart = hexDistance(cell, there);
        if (apart > 4) continue; // further than any ring on this company
        expect(apart).toBeGreaterThanOrEqual(leastApart(id, other, mayTouch, tierOf));
      }
    }
  });
});

describe("Greg's radiating rule, which the chart now serves", () => {
  /**
   * Greg, 2026-10-02: *"if I drag a family group away from a shared parent, the
   * highest-ranking node in the dragged group should position itself closest to
   * its parent, regardless of how far that is. This should mean the connection
   * line flows freely from that node to the parent uninterrupted — like a leaf
   * on a branch."*
   *
   * Under the old mechanism that was read against the branch's *own parent*.
   * It is now read against the **master centre**, which is what Greg asked for
   * on 2026-10-17 — *"the orientation should always be on the side of the
   * dragged node opposite master-centre"* — and the two agree wherever the
   * parent is on the way home, which is wherever the map is radial at all.
   */
  const c = company();

  it("puts the branch on the far side of the node you dragged", () => {
    const laid = dropAt(c, 8);
    const reach = hexDistance(laid.hand, ORIGIN);
    let outward = 0;
    let of = 0;
    for (const [id, cell] of laid.cells) {
      if (id === c.anchor.id) continue;
      of++;
      if (hexDistance(cell, ORIGIN) > reach) outward++;
    }
    expect(of).toBeGreaterThan(20);
    // Not every single cell: a crowd packs round its node and half of any ring
    // round a node is nearer the centre than the node is.
    expect(outward / of).toBeGreaterThan(0.75);
  });

  it("leaves the way home open, so the chain can run straight", () => {
    const laid = dropAt(c, 8);
    const taken = new Set([...laid.cells.values()].map(cellKey));
    const steps = hexDistance(laid.hand, ORIGIN);
    let clear = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const key = cellKey({
        q: Math.round(laid.hand.q * (1 - t)),
        r: Math.round(laid.hand.r * (1 - t)),
      });
      if (!taken.has(key)) clear++;
    }
    // The straight line from the node back to the master centre is the branch's
    // own way home, and the branch is not standing on it.
    expect(clear).toBe(steps - 1);
  });
});

describe("the two ends of the dial", () => {
  const c = company();

  it("hands a descendant back to the master centre's own cell, at full deference", () => {
    const laid = dropAt(c, 1);
    let back = 0;
    let of = 0;
    for (const [id, cell] of laid.cells) {
      if (id === c.anchor.id) continue;
      const was = c.laid.cells.get(id);
      if (!was) continue;
      of++;
      if (cellKey(cell) === cellKey(was)) back++;
    }
    expect(of).toBeGreaterThan(20);
    // Everything a rung or more below the hand goes back where it was. Not all
    // of it: the node's own crowd travels with the node, which is Law 2, and
    // the taper is one rung, so the first rung is the one that moved.
    expect(back / of).toBeGreaterThan(0.8);
  });

  it("does not become its own master centre, which is the whole point", () => {
    /**
     * The retired model laid the branch as a company of its own, so its
     * sub-branches fanned **all the way round** the node in the hand. Measured
     * on Northwind, Everest Region's three business units then overlapped one
     * another by 152° as seen from Everest. A chart does not fan: it grows one
     * way, away from the master centre.
     */
    const laid = dropAt(c, 8);
    const bearings: number[] = [];
    for (const [id, cell] of laid.cells) {
      if (id === c.anchor.id) continue;
      const dq = cell.q - laid.hand.q;
      const dr = cell.r - laid.hand.r;
      bearings.push(Math.atan2(Math.sqrt(3) * (dr + dq / 2), 1.5 * dq));
    }
    const away = Math.atan2(
      Math.sqrt(3) * (laid.hand.r + laid.hand.q / 2),
      1.5 * laid.hand.q,
    );
    const off = bearings.map((b) => {
      const d = Math.abs(b - away) % (2 * Math.PI);
      return d > Math.PI ? 2 * Math.PI - d : d;
    });
    // Three quarters of the branch within a right angle of straight out. Under
    // the retired model this was a fan over the whole circle.
    const inFront = off.filter((d) => d < Math.PI / 2).length;
    expect(inFront / off.length).toBeGreaterThan(0.75);
  });
});

/** Is `id` anywhere below `anchorId`? */
function isUnder(tree: OrbitalTree, anchorId: string, id: string): boolean {
  let at: string | null = id;
  while (at) {
    const parent: string | null = tree.units.get(at)?.parentId ?? null;
    if (parent === anchorId) return true;
    at = parent;
  }
  return false;
}
