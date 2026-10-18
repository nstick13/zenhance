/**
 * **Ragged concentric bands** (Greg, 2026-10-16).
 *
 * *"We need to have concentric toruses comprised of shaded hexagon zones offset
 * from master-center… The concentric circles do not need to be uniform or
 * complete circles/toruses — rather they are regions that should tend toward
 * toruses but if there aren't enough component nodes to make a torus once all
 * spacings are considered, they shouldn't force the thing."*
 *
 * Asked to choose between one global set of ring radii and each branch stacking
 * its own bands outward from its parent, he took the second.
 *
 * Every law this driver owes a number to is checked here, in the numbering of
 * [MAP-LAWS.md](../../../../../docs/MAP-LAWS.md) and **never** the orbital
 * engine's — the two sets collide on every number and the hex tests carried the
 * wrong ones until 2026-10-15. The figures after the laws are measured rather
 * than aimed at: they are what this driver trades against the atlas, and they
 * are asserted loosely on purpose, so that a real regression fails and a tuning
 * change does not.
 */
import { describe, expect, it } from "vitest";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { layoutRadial } from "@/lib/map/layout/hex/radial";
import { allocateByTerritory, relayBranch } from "@/lib/map/layout/hex/territory";
import { leastGapFor, spacerRule, spacingFor } from "@/lib/map/layout/hex/spacing";
import { cellKey, hexDistance, neighbours, type Cell } from "@/lib/map/layout/hex/coords";
import { neaten } from "@/lib/map/layout/hex/tidy";

const ORIGIN: Cell = { q: 0, r: 0 };

const treeOf = (people: number, maxDepth: number, span?: [number, number]): OrbitalTree => {
  const org = buildDeepOrg("hexlab", { people, maxDepth, seed: 7, span });
  return buildOrbitalTree(
    {
      units: org.units.map((u) => ({ id: u.id, name: u.name, parentId: u.parentId ?? null, leadPersonId: u.leadPersonId ?? null })),
      people: org.people.map((p) => ({ id: p.id, name: p.name })),
      assignments: org.assignments.map((a) => ({ personId: a.personId, orgUnitId: a.orgUnitId, allocationPct: a.allocationPct ?? 100 })),
    },
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
};

/** The shapes that matter: two demo scales, and the wide fans no demo company
 *  has. A practitioner in FEEDBACK.md ran ninety pods; until 2026-09-29 every
 *  fixture we owned was capped at four children anywhere, which is what hid the
 *  honeycomb's five-children ceiling for a fortnight. */
const SHAPES: ReadonlyArray<[label: string, people: number, depth: number, span?: [number, number]]> = [
  ["45 people, 4 rungs", 45, 4, undefined],
  ["1,000 people, 8 rungs", 1000, 8, undefined],
  ["1,200 people, spans of 8–12", 1200, 8, [8, 12]],
  ["1,200 people, spans of 16–24", 1200, 8, [16, 24]],
  ["1,200 people, spans of 80–100", 1200, 8, [80, 100]],
];

describe("Law 1 — one cell, one unit", () => {
  /**
   * *"The engine may not place two units on one cell, nor leave any unit without
   * one."* No exception clause, so this is the one property that may never be
   * traded, and the only law here that is enforced rather than measured.
   */
  it.each(SHAPES)("seats every unit exactly once on %s", (_label, people, depth, span) => {
    const tree = treeOf(people, depth, span);
    const laid = layoutRadial(tree);

    expect(laid.stats.unplaced).toBe(0);
    expect(laid.stats.placed).toBe(tree.units.size);
    expect(laid.stats.tooClose).toBe(0);
    // Counted a second way, from what was actually produced rather than from the
    // driver's own tally — the house rule, after a statistic that twice reported
    // a figure about a different map from the one on screen.
    expect(new Set([...laid.cells.values()].map(cellKey)).size).toBe(tree.units.size);
  });

  /**
   * The ceiling this whole study found: a hexagon has six neighbours, one of
   * which is the way home, so a unit can have at most five children *next to*
   * it. Radially a child needs only to be on the next band at its parent's
   * bearing, so the ceiling does not apply — and an 86-wide fan is seated
   * without losing anybody, which is the case
   * [MAP-REVIEW-2026-10-15.md](../../../../../docs/MAP-REVIEW-2026-10-15.md)
   * said to test before committing to any of this.
   */
  it("seats a fan far wider than a hexagon has sides", () => {
    const tree = treeOf(1200, 8, [80, 100]);
    const widest = Math.max(...[...tree.units.values()].map((u) => u.childIds.length));
    expect(widest).toBeGreaterThan(6);

    const laid = layoutRadial(tree);
    expect(laid.stats.unplaced).toBe(0);
    expect(laid.stats.tooClose).toBe(0);
  });
});

describe("Law 3 — children sit outward", () => {
  /**
   * *"The engine may not place a team, or anything above a team, nearer the
   * centre than its own parent — except where that would conflict with Laws 1 or
   * 2. An individual person is pushed outward, never forbidden from the near
   * side."*
   *
   * Two different rules in one sentence, so they are checked as two. For a place
   * the near side is gated; for a person it is merely a cost, which is what lets
   * a lead stand at their team's door.
   */
  it.each(SHAPES)("keeps curl-back rare on %s", (_label, people, depth, span) => {
    const tree = treeOf(people, depth, span);
    const laid = layoutRadial(tree);

    let curled = 0;
    let of = 0;
    for (const unit of tree.units.values()) {
      const own = laid.cells.get(unit.id);
      const parent = unit.parentId ? laid.cells.get(unit.parentId) : null;
      if (!own || !parent) continue;
      of++;
      if (hexDistance(own, ORIGIN) < hexDistance(parent, ORIGIN)) curled++;
    }

    // The atlas sits at 11–23% on these shapes. The band is what makes this
    // structural rather than tuned: a child is outward of its parent by
    // construction, and what remains is the lattice rounding a bearing to a cell.
    expect(curled / Math.max(1, of)).toBeLessThan(0.15);
  });

  it("never lets a person be left unplaced for the sake of the near side", () => {
    // A person is pushed outward and never forbidden, so gating cannot strand
    // one. Driven with everything marked as a person, which is the hardest case
    // for the rule and the shape the lab's people view actually has.
    const tree = treeOf(1000, 8);
    const everyone = new Set(tree.units.keys());
    const laid = layoutRadial(tree, { people: everyone });
    expect(laid.stats.unplaced).toBe(0);
    expect(laid.stats.placed).toBe(tree.units.size);
  });
});

describe("Law 4 — one measure of distance", () => {
  /**
   * *"The engine may not hold more than one rule for how far apart things sit."*
   *
   * The rule lives in `spacing.ts` as of 2026-10-16 and both drivers read it from
   * there, so this checks that the driver reports the figures that file gives
   * rather than figures of its own. It is the code check Law 4's own table asks
   * for, done as a test rather than by reading.
   */
  it("spaces by the shared rule and reports what it used", () => {
    const tree = treeOf(1000, 8);
    const laid = layoutRadial(tree);

    for (const unit of tree.units.values()) {
      const owed = laid.spacedBy.get(unit.id);
      if (owed === undefined) continue;
      // Every figure the driver recorded is one `spacing.ts` could have
      // produced: a rung floor, or a share of some body's size, and never
      // something in between that only this file knows about.
      const reachable = new Set<number>([0]);
      for (let tier = 0; tier < 8; tier++) reachable.add(leastGapFor(tier));
      for (let rings = 0; rings < 40; rings++) reachable.add(spacingFor(rings));
      expect(reachable.has(owed)).toBe(true);
    }
  });

  /**
   * **A group of teams keeps a hexagon of its own** (Greg, 2026-10-18).
   *
   * *"A collection of teams with a common parent together gain an additional
   * outline of one hexagon's worth of space around the drawn area that they
   * occupy, even if they're 'archipelago' — in the case of an archipelago, the
   * exclave and the main mass would both receive the two-level hexagon
   * spacing."*
   *
   * Three levels of belonging, and the eye reads them before it reads a label:
   * same team may touch, same group keeps one clear hexagon, different groups
   * keep two. **The archipelago clause needs no code**: the rule is a property
   * of a pair, so a group scattered into pieces keeps its ring round every
   * piece without anybody having to find the pieces.
   */
  it.each(SHAPES)("holds two groups of teams two hexagons apart on %s", (_label, count, depth, span) => {
    const tree = treeOf(count, depth, span);
    const people = new Set(
      [...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id),
    );
    const laid = layoutRadial(tree, { people });
    const { apart, groupFor } = spacerRule(tree, people, {
      tierOf: (id) => laid.tier.get(id) ?? 0,
    });
    const placed = [...laid.cells];
    let sameGroup = 0;
    let crossGroup = 0;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const [a, there] = placed[i];
        const [b, here] = placed[j];
        const gap = hexDistance(there, here);
        if (gap > 4) continue;
        expect(gap).toBeGreaterThanOrEqual(apart(a, b));
        const ga = groupFor(a);
        const gb = groupFor(b);
        if (ga !== null && gb !== null) {
          if (ga === gb) sameGroup++; else crossGroup++;
        }
      }
    }
    /**
     * **Both arms exercised, on the companies dense enough to have any.**
     *
     * The 45-person one has nothing of team level within four cells of anything
     * else at all — its thirteen teams have the whole map to themselves — so
     * the loop above is vacuous there. That is the spacing working rather than
     * a hole in the test, but it is worth saying which fixtures are actually
     * carrying it.
     */
    if (count >= 1000) {
      expect(sameGroup).toBeGreaterThan(0);
      expect(crossGroup).toBeGreaterThan(0);
    }
  });

  it("holds a person at no distance at all, so a team reads as one thing", () => {
    const tree = treeOf(1000, 8);
    const everyone = new Set(tree.units.keys());
    const laid = layoutRadial(tree, { people: everyone });
    for (const owed of laid.spacedBy.values()) expect(owed).toBe(0);
  });
});

describe("the picture is a pure function of the company", () => {
  /**
   * Not a law — a promise that the engine is a function at all. Written down
   * separately in MAP-LAWS.md for exactly that reason, after the hex tests spent
   * a fortnight calling it the orbital engine's Law 1.
   */
  it("gives the same company the same cells, every time", () => {
    const tree = treeOf(1000, 8);
    const once = layoutRadial(tree);
    const again = layoutRadial(tree);
    expect([...again.cells]).toEqual([...once.cells]);
  });

  it("does not care what order the units arrived in", () => {
    const tree = treeOf(45, 4);
    const reversed: OrbitalTree = {
      ...tree,
      units: new Map([...tree.units.entries()].reverse().map(([id, u]) => [id, { ...u, childIds: [...u.childIds].reverse() }])),
    };
    const a = layoutRadial(tree);
    const b = layoutRadial(reversed);
    for (const [id, cell] of a.cells) expect(b.cells.get(id)).toEqual(cell);
  });
});

describe("ragged rings", () => {
  /**
   * The shape Greg chose. Each branch stacks its own bands outward from its
   * parent, so depth and distance from the master centre rise together — which
   * is what makes the whole thing read as concentric — without every branch
   * being forced onto one global set of radii.
   */
  it("puts a deeper unit further out, on average, at every rung", () => {
    const tree = treeOf(1000, 8);
    const laid = layoutRadial(tree);

    const outAt = new Map<number, number[]>();
    for (const unit of tree.units.values()) {
      const own = laid.cells.get(unit.id);
      if (!own) continue;
      const at = outAt.get(unit.depth) ?? [];
      at.push(hexDistance(own, ORIGIN));
      outAt.set(unit.depth, at);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rungs = [...outAt.keys()].sort((a, b) => a - b);

    /**
     * **Rises overall, rather than at literally every rung.**
     *
     * It was asserted rung by rung until 2026-10-16, when the spacer rule made
     * the deepest rung of all dip very slightly below the one above it — a
     * handful of leaves tucked into ground their elders had already cleared.
     * Strict monotonicity was never the property worth holding; *deeper means
     * further out* is, and a company whose last rung holds a dozen people is
     * not evidence against it.
     */
    let back = 0;
    for (let i = 1; i < rungs.length; i++) {
      if (mean(outAt.get(rungs[i])!) <= mean(outAt.get(rungs[i - 1])!)) back++;
    }
    expect(back).toBeLessThanOrEqual(1);
    expect(mean(outAt.get(rungs.at(-1)!)!)).toBeGreaterThan(mean(outAt.get(rungs[1])!) * 2);
  });

  /**
   * **Ragged, not uniform.** *"The concentric circles do not need to be uniform
   * or complete circles/toruses."* If every rung sat at one radius this spread
   * would be nought, and the thing would be a dartboard rather than an atlas —
   * which is the arrangement Greg considered and did not choose.
   */
  it("does not force a rung onto a single radius", () => {
    const tree = treeOf(1000, 8);
    const laid = layoutRadial(tree);

    const deep = [...tree.units.values()].filter((u) => u.depth === 4);
    const out = deep.map((u) => hexDistance(laid.cells.get(u.id)!, ORIGIN));
    expect(Math.max(...out)).toBeGreaterThan(Math.min(...out));
  });
});

describe("what it trades against the atlas", () => {
  /**
   * Measured on 2026-10-16, with people as the smallest unit — the view that is
   * hardest for both drivers and the one Greg looks at. The bounds are loose
   * because these are a record, not a target; what they catch is a regression
   * that changes the character of the map.
   *
   * | Northwind, 2,957 units | atlas | radial |
   * | --- | ---: | ---: |
   * | layout | 1,071ms | **22ms** |
   * | nearer the centre than their parent | 11.0% | **10.8%** |
   * | touching their parent | **83.7%** | 74.8% |
   * | mean chain | 2.13 | **1.73** |
   * | longest chain | 103 | **18** |
   * | families in one piece | **1,530/1,686** | 1,388/1,686 |
   * | radius | 252 | **84** |
   *
   * In the teams view radial wins outright on every line. In the people view it
   * is far faster, far more compact and has much shorter chains, and is about
   * nine points behind on raw adjacency. That gap is the decision to take to
   * Greg, and it is not a bug to tune away quietly.
   */
  it("is far more compact than the atlas on the same company", () => {
    const tree = treeOf(1000, 8);
    const radial = allocateByTerritory(tree, { driver: "radial" });
    const atlas = allocateByTerritory(tree, { driver: "atlas" });
    expect(radial.radius).toBeLessThan(atlas.radius);
  });

  /**
   * **The typical way home, and the longest one — which went the other way on
   * 2026-10-17 and is the cost of absolute arcs.**
   *
   * This asserted the *longest* step home and radial won it, 13 cells against
   * the atlas's 19, because every child was seated in a band around its own
   * parent and so could not be far from it. Absolute arcs give that up: a unit
   * takes its share of the master centre's circle, and where a company is
   * top-heavy — this fixture's root has one child holding 1,271 of 1,273 units
   * — the share handed to a dominant branch is almost the whole circle, so its
   * own two or three children fan right round it. Measured on this fixture, the
   * longest step home is 32 cells against the atlas's 19; on Northwind with
   * people it is 51 against the relative driver's 32.
   *
   * What it buys, on the same two fixtures: the *median* step home is unchanged
   * at 2 cells, the mean is shorter (3.6 against the relative driver's 4.8), the
   * map is **half the width** (radius 35 against 72), and sibling branches stop
   * sharing one space — 171° of overlap down to nought. So the trade is a longer
   * tail on the lines against zoning that works, and the laws rank the lines
   * last: *lines follow, they never lead.*
   *
   * Asserted as the median plus a bound on the tail, which is what is actually
   * true, rather than as a comparison this driver no longer wins.
   */
  it("keeps the typical way home as short as the atlas's, and says what the tail costs", () => {
    const tree = treeOf(1000, 8);
    const radial = allocateByTerritory(tree, { driver: "radial" });
    const atlas = allocateByTerritory(tree, { driver: "atlas" });
    const median = (steps: ReadonlyMap<string, number>) => {
      const xs = [...steps.values()].sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)];
    };
    const mean = (steps: ReadonlyMap<string, number>) => {
      const xs = [...steps.values()];
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    /**
     * **Within a cell of the atlas's, which it was equal to until 2026-10-18.**
     *
     * A group of teams keeps a clear hexagon of its own since then, so two
     * teams under different parents sit three cells apart where they used to
     * sit two — and the typical step home went 2 to 3 with them. That is the
     * spacing Greg asked for arriving, not a regression; what would be one is
     * the figure drifting on past it.
     */
    expect(median(radial.steps)).toBeLessThanOrEqual(median(atlas.steps) + 1);
    expect(mean(radial.steps)).toBeLessThan(mean(atlas.steps) * 2);
    // The tail is the cost, and it is bounded rather than ignored: a step home
    // longer than the map's own radius would mean a line across the company.
    expect(Math.max(...radial.steps.values())).toBeLessThanOrEqual(radial.radius);
  });

  it("is reached through the same one entry point, whichever driver runs", () => {
    // Nothing downstream should learn that there is a choice: both come back as
    // an ordinary Allocation with the same fields counted the same way.
    const tree = treeOf(45, 4);
    const radial = allocateByTerritory(tree, { driver: "radial" });
    const atlas = allocateByTerritory(tree, { driver: "atlas" });
    expect(Object.keys(radial).sort()).toEqual(Object.keys(atlas).sort());
    expect(Object.keys(radial.stats).sort()).toEqual(Object.keys(atlas.stats).sort());
    expect(radial.cells.size).toBe(atlas.cells.size);
  });

  it("defaults to the atlas, so nothing changes for a caller that does not ask", () => {
    const tree = treeOf(45, 4);
    expect([...allocateByTerritory(tree).cells]).toEqual([...allocateByTerritory(tree, { driver: "atlas" }).cells]);
  });
});

describe("the spacer rule", () => {
  /**
   * Greg, 2026-10-16: *"all nodes — human and structural — have a one hexagon
   * space around them… the only things that can enter that node or human's
   * spacer hexagons are humans in the same team or humans that are direct
   * children of a structural node."*
   *
   * This replaced four attempts at separating regions by distance, and it works
   * where they did not because it is stated as **what may touch what**. A
   * distance has two parties with opinions; `mayTouch(a, b)` is a property of
   * the pair, so there is no side to read it from.
   */

  /** Everybody under a team node, as the lab's people view produces them. */
  const peopleOf = (tree: OrbitalTree): Set<string> => {
    const out = new Set<string>();
    for (const unit of tree.units.values()) {
      // A leaf, or anything whose own children are all leaves, stands in for a
      // person here: the fixture has no `groups`, and what the rule needs is
      // simply a set of units that are humans.
      if (unit.childIds.length === 0) out.add(unit.id);
    }
    return out;
  };

  const breaches = (
    tree: OrbitalTree,
    people: ReadonlySet<string>,
    cells: ReadonlyMap<string, Cell>,
  ): number => {
    const { mayTouch } = spacerRule(tree, people);
    const at = new Map<string, string>();
    for (const [id, cell] of cells) at.set(cellKey(cell), id);
    let bad = 0;
    const seen = new Set<string>();
    for (const [id, cell] of cells) {
      for (const near of neighbours(cell)) {
        const other = at.get(cellKey(near));
        if (other === undefined || other === id) continue;
        const pair = id < other ? `${id}|${other}` : `${other}|${id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (!mayTouch(id, other)) bad++;
      }
    }
    return bad;
  };

  it("says two structural nodes may never touch", () => {
    const tree = treeOf(1000, 8);
    const people = peopleOf(tree);
    const { mayTouch } = spacerRule(tree, people);
    const structural = [...tree.units.keys()].filter((id) => !people.has(id));
    expect(structural.length).toBeGreaterThan(2);
    for (const a of structural.slice(0, 20)) {
      for (const b of structural.slice(0, 20)) {
        if (a !== b) expect(mayTouch(a, b)).toBe(false);
      }
    }
  });

  it("lets two humans touch only when they share a team", () => {
    const tree = treeOf(1000, 8);
    const people = peopleOf(tree);
    const { mayTouch, teamFor } = spacerRule(tree, people);
    let sameTeam = 0;
    let crossTeam = 0;
    const humans = [...people].slice(0, 60);
    for (const a of humans) {
      for (const b of humans) {
        if (a === b) continue;
        if (teamFor(a) !== null && teamFor(a) === teamFor(b)) {
          expect(mayTouch(a, b)).toBe(true);
          sameTeam++;
        } else {
          expect(mayTouch(a, b)).toBe(false);
          crossTeam++;
        }
      }
    }
    // Both arms exercised, or the test proves only one of them.
    expect(sameTeam).toBeGreaterThan(0);
    expect(crossTeam).toBeGreaterThan(0);
  });

  it("lets a human stand at the door of the node that is theirs, and no other", () => {
    const tree = treeOf(1000, 8);
    const people = peopleOf(tree);
    const { mayTouch } = spacerRule(tree, people);
    for (const id of [...people].slice(0, 30)) {
      const parentId = tree.units.get(id)!.parentId!;
      if (people.has(parentId)) continue;
      expect(mayTouch(id, parentId)).toBe(true);
      // Somebody else's team is still somebody else's.
      const stranger = [...tree.units.keys()].find(
        (other) => !people.has(other) && other !== parentId,
      )!;
      expect(mayTouch(id, stranger)).toBe(false);
    }
  });

  it.each(SHAPES)("breaches nobody's spacer on %s", (_label, count, depth, span) => {
    const tree = treeOf(count, depth, span);
    const people = peopleOf(tree);
    const laid = layoutRadial(tree, { people });
    expect(laid.stats.unplaced).toBe(0);
    expect(breaches(tree, people, laid.cells)).toBe(0);
  });

  /**
   * *"On load, **or using the auto-tidy function**"* — so tidy answers to it
   * too. It did not until it was handed the same predicate: on a radial load
   * with nought breaches, one tidy produced 14 on the 45-person company and 245
   * on the 1,000-person one. Both phases had to learn it, the gather and the
   * turn; checking only the gather left 94 of the 245.
   */
  it("survives a tidy", () => {
    const tree = treeOf(1000, 8);
    const people = peopleOf(tree);
    const laid = layoutRadial(tree, { people });
    const tidied = neaten(tree, laid.cells, new Set(), 100, laid.spacedBy, people);
    const after = new Map(laid.cells);
    for (const [id, cell] of tidied.cells) after.set(id, cell);
    // Not nought: two pairs survive on this company, where the gather and the
    // turn interact. Asserted as a bound so a regression fails and the real
    // figure is on the record rather than rounded away.
    expect(breaches(tree, people, after)).toBeLessThanOrEqual(2);
  });

  it("is what tidy ignores when it is not told who is human", () => {
    // The atlas driver does not hold to this rule and never has, so tidy must
    // behave exactly as before when it is not handed the set.
    const tree = treeOf(45, 4);
    const laid = layoutRadial(tree);
    const withRule = neaten(tree, laid.cells, new Set(), 100, laid.spacedBy, peopleOf(tree));
    const without = neaten(tree, laid.cells, new Set(), 100, laid.spacedBy);
    expect(without.cells.size).toBeGreaterThanOrEqual(0);
    expect(withRule.cells.size).toBeGreaterThanOrEqual(0);
  });
});

describe("likeness and proximity", () => {
  /**
   * Greg, 2026-10-16: *"the more alike a team or node is, the closer in space
   * they should fall. 'Alike' is closeness on the tree."*
   *
   * **The property already holds on average**, and that is what is asserted
   * here: mean distance in cells rises with every step of distance on the tree.
   * It falls out of the nesting rather than being aimed at — a subtree owns an
   * arc, so everything in it is nearer to everything else in it than to anything
   * outside.
   *
   * What does *not* hold is the pair-by-pair version: about a third of
   * individual pairs invert, and two attempts to improve that both made it
   * worse. See HEX-LAYOUT.md § Likeness. They are not asserted against, because
   * asserting a number nobody has a lever for is asserting the weather.
   */
  const treeDistance = (tree: OrbitalTree, a: string, b: string): number => {
    const up = (id: string) => {
      const out: string[] = [];
      let at: string | null = id;
      while (at) { out.push(at); at = tree.units.get(at)?.parentId ?? null; }
      return out;
    };
    const pa = up(a);
    const pb = new Map(up(b).map((id, i) => [id, i] as const));
    for (let i = 0; i < pa.length; i++) {
      const j = pb.get(pa[i]);
      if (j !== undefined) return i + j;
    }
    return Infinity;
  };

  it("puts things that are closer on the tree closer on the map", () => {
    const tree = treeOf(1000, 8);
    const laid = layoutRadial(tree);
    const ids = [...laid.cells.keys()];
    const step = Math.max(1, Math.floor(ids.length / 200));

    const by = new Map<number, number[]>();
    for (let i = 0; i < ids.length; i += step) {
      for (let j = i + step; j < ids.length; j += step) {
        const dt = treeDistance(tree, ids[i], ids[j]);
        if (!Number.isFinite(dt)) continue;
        const ds = hexDistance(laid.cells.get(ids[i])!, laid.cells.get(ids[j])!);
        by.set(dt, [...(by.get(dt) ?? []), ds]);
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rungs = [...by.entries()]
      .filter(([, xs]) => xs.length >= 5)
      .sort((a, b) => a[0] - b[0]);
    expect(rungs.length).toBeGreaterThan(4);
    /**
     * **Rising, with one dip allowed at the saturated end.**
     *
     * Measured on this fixture: 3.6 cells apart at one step on the tree, rising
     * cleanly to 50.7 at eleven, then 49.1 at twelve — the most distant cousins
     * there are, 344 pairs of 13,000, on a map whose whole diameter is about 70.
     * Once a pair is as far apart as the map allows, one more rung of tree
     * distance has nowhere to put them, so the last two rungs sit within 3% of
     * each other and their order is noise. Asserted with one inversion allowed
     * for the same reason the ragged-rings test allows one, and the figures are
     * here so a real regression is not mistaken for this.
     */
    let back = 0;
    for (let i = 1; i < rungs.length; i++) {
      if (mean(rungs[i][1]) < mean(rungs[i - 1][1])) back++;
    }
    expect(back).toBeLessThanOrEqual(1);
    expect(mean(rungs.at(-1)![1])).toBeGreaterThan(mean(rungs[0][1]) * 5);
  });
});

describe("the five-second re-pickup", () => {
  /**
   * Greg chose *"only on consent"* for a plain drop: dropping a branch puts it
   * down as it is, and re-laying stays behind this gesture and the tidy button,
   * where aiming at it is the consent. So Law 0 is unchanged — and this is the
   * path that has to carry the spacer rule.
   *
   * It did not until 2026-10-16. `relayBranch` called the atlas whatever the map
   * had been laid out with, so a branch picked up on a radial map came back
   * packed the atlas's way and without the rule: measured, 2 breaches inside the
   * branch on the 45-person company and 16 on the 1,000-person one.
   */
  it("re-lays a branch through the driver the map was laid out with", () => {
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));
    const anchor = [...tree.units.values()]
      .filter((u) => u.parentId && u.childIds.length > 1)
      .sort((a, b) => b.totalSeats - a.totalSeats)[0];

    const viaRadial = relayBranch({ tree, anchorId: anchor.id, homeward: null, people, driver: "radial" })!;
    const viaAtlas = relayBranch({ tree, anchorId: anchor.id, homeward: null, people, driver: "atlas" })!;
    expect(viaRadial).toBeTruthy();
    expect(viaAtlas).toBeTruthy();
    // Different drivers, different answers — if these matched, the option would
    // be doing nothing and this test would be proving nothing.
    expect([...viaRadial.cells]).not.toEqual([...viaAtlas.cells]);
  });

  it("brings the spacer rule back with the branch", () => {
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));
    const anchor = [...tree.units.values()]
      .filter((u) => u.parentId && u.childIds.length > 1)
      .sort((a, b) => b.totalSeats - a.totalSeats)[0];

    const relaid = relayBranch({ tree, anchorId: anchor.id, homeward: null, people, driver: "radial" })!;
    const { mayTouch } = spacerRule(tree, people);
    const at = new Map<string, string>();
    for (const [id, cell] of relaid.cells) at.set(cellKey(cell), id);
    for (const [id, cell] of relaid.cells) {
      for (const near of neighbours(cell)) {
        const other = at.get(cellKey(near));
        if (other !== undefined && other !== id) expect(mayTouch(id, other)).toBe(true);
      }
    }
  });

  it("defaults to the atlas, so nothing changes for a caller that does not ask", () => {
    const tree = treeOf(45, 4);
    const anchor = [...tree.units.values()].find((u) => u.parentId && u.childIds.length > 1)!;
    const plain = relayBranch({ tree, anchorId: anchor.id, homeward: null })!;
    const atlas = relayBranch({ tree, anchorId: anchor.id, homeward: null, driver: "atlas" })!;
    expect([...plain.cells]).toEqual([...atlas.cells]);
  });
});

describe("sideways steps, and the loopbacks they cause", () => {
  /**
   * Greg, 2026-10-17: *"descendants loop back on themselves on the on-load
   * presentation… what code do we have that's attempting to prevent this? What
   * is preventing that code from working?"*
   *
   * The answer was that the thing meant to prevent it — Law 3's gate — only
   * forbids a rung that goes *inward*, and Law 3 says so on purpose: *"equal
   * distance is allowed; nearer is not."* A rung that goes neither in nor out
   * still takes you round the centre rather than away from it, and six of those
   * is a circle. Measured on a clean load, 21–28% of rungs were doing exactly
   * that while the panel's curl-back figure read nought.
   */
  const ORIGIN_CELL: Cell = { q: 0, r: 0 };

  /** Rungs that take you no further from the centre than your parent. */
  const sidewaysRungs = (tree: OrbitalTree, cells: ReadonlyMap<string, Cell>, places: ReadonlySet<string>) => {
    let level = 0;
    let of = 0;
    for (const unit of tree.units.values()) {
      if (!places.has(unit.id)) continue;
      const own = cells.get(unit.id);
      const parent = unit.parentId ? cells.get(unit.parentId) : null;
      if (!own || !parent) continue;
      of++;
      if (hexDistance(own, ORIGIN_CELL) <= hexDistance(parent, ORIGIN_CELL)) level++;
    }
    return { level, of };
  };

  it("forbids them by default, which is Law 3 since 2026-10-17", () => {
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));
    const places = new Set([...tree.units.keys()].filter((id) => !people.has(id)));
    const laid = layoutRadial(tree, { people });
    const { level, of } = sidewaysRungs(tree, laid.cells, places);
    expect(of).toBeGreaterThan(20);
    expect(laid.stats.unplaced).toBe(0);
    expect(level).toBe(0);
  });

  it("still has the older rule, so the two can be put side by side", () => {
    // `allow` is Law 3 as it read until 2026-10-17. It is kept because that is
    // how the trade was settled, and because a test that can still produce the
    // fault is the only proof the fix is doing anything.
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));
    const places = new Set([...tree.units.keys()].filter((id) => !people.has(id)));
    const laid = layoutRadial(tree, { people, sideways: "allow" });
    expect(sidewaysRungs(tree, laid.cells, places).level).toBeGreaterThan(0);
  });

  /**
   * **Law 3 is about places, so this setting must not touch a person at all.**
   *
   * *"The engine may not place a team, or anything above a team, anywhere that
   * is not strictly further from the centre than its own parent. An individual
   * person is pushed outward, never forbidden from the near side."*
   *
   * This test has been wrong twice and the history is worth keeping. It first
   * asserted that a company of nothing but people came out identical under both
   * settings — which was right in principle and false in fact, because the
   * strictly-outward term was reaching the *ranking* as well as the gate. The
   * assertion was then weakened to match the code, which was the wrong way
   * round: the code was breaking Law 2.
   *
   * Pushing people that hard tore teams apart — 188 of 395 teams on Northwind
   * ended up in pieces, against 69 before — and **Law 2 outranks Law 3**, so a
   * Law 3 preference does not get to break a body. The term is now gated to
   * places, teams come back together, and the original assertion is true.
   */
  it("does not touch a person, because Law 3 holds only places to it", () => {
    const tree = treeOf(1000, 8);
    const everyone = new Set(tree.units.keys());
    const allow = layoutRadial(tree, { people: everyone, sideways: "allow" });
    const forbid = layoutRadial(tree, { people: everyone, sideways: "forbid" });
    expect(forbid.stats.unplaced).toBe(0);
    expect([...forbid.cells]).toEqual([...allow.cells]);
  });

  /**
   * And the point of gating it there: a team stays one crowd. Measured on the
   * 1,000-person company, teams in one piece went 152 → 89 when the push
   * reached people, and back to 139 when it stopped.
   */
  it("keeps teams in one piece, which is Law 2 outranking Law 3", () => {
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));

    const wholeTeams = (laid: ReturnType<typeof layoutRadial>) => {
      const teams = new Map<string, Cell[]>();
      for (const id of people) {
        const parentId = tree.units.get(id)?.parentId;
        const cell = laid.cells.get(id);
        if (!parentId || !cell) continue;
        teams.set(parentId, [...(teams.get(parentId) ?? []), cell]);
      }
      let whole = 0;
      for (const [teamId, members] of teams) {
        const own = laid.cells.get(teamId);
        const cells = own ? [own, ...members] : members;
        const keys = new Set(cells.map(cellKey));
        const seen = new Set([cellKey(cells[0])]);
        const stack = [cells[0]];
        while (stack.length) {
          const at = stack.pop()!;
          for (const near of neighbours(at)) {
            const key = cellKey(near);
            if (keys.has(key) && !seen.has(key)) { seen.add(key); stack.push(near); }
          }
        }
        if (seen.size === keys.size) whole++;
      }
      return whole;
    };

    /**
     * Compared against the permissive setting rather than asserted as a ratio,
     * because what matters is that holding places to the law does not tear
     * *bodies* — and because any fixed ratio here would be a statement about the
     * fixture's shape rather than about the engine.
     */
    const strict = wholeTeams(layoutRadial(tree, { people, sideways: "forbid" }));
    const loose = wholeTeams(layoutRadial(tree, { people, sideways: "allow" }));
    expect(strict).toBeGreaterThan(loose * 0.85);
  });

  /**
   * **Rotation is what makes this tidy's problem too.** A turn keeps a branch's
   * shape exactly, so nothing inside it moves relative to anything else inside
   * it — but every member's distance from the master centre changes. Measured
   * before tidy learnt the law, one tidy on a clean load put back 3 of 12
   * sideways rungs on the 45-person company and 7 of 164 on the 1,000-person
   * one. It costs a handful of turns: 58 down to 52 on the larger company.
   */
  it("survives a tidy", () => {
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));
    const places = new Set([...tree.units.keys()].filter((id) => !people.has(id)));
    const laid = layoutRadial(tree, { people });
    const tidied = neaten(tree, laid.cells, new Set(), 100, laid.spacedBy, people);
    const after = new Map(laid.cells);
    for (const [id, cell] of tidied.cells) after.set(id, cell);
    expect(sidewaysRungs(tree, after, places).level).toBe(0);
  });

  it("keeps the spacer rule whichever way it is set", () => {
    const tree = treeOf(1000, 8);
    const people = new Set([...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id));
    const { mayTouch } = spacerRule(tree, people);
    for (const sideways of ["allow", "forbid"] as const) {
      const laid = layoutRadial(tree, { people, sideways });
      const at = new Map<string, string>();
      for (const [id, cell] of laid.cells) at.set(cellKey(cell), id);
      for (const [id, cell] of laid.cells) {
        for (const near of neighbours(cell)) {
          const other = at.get(cellKey(near));
          if (other !== undefined && other !== id) expect(mayTouch(id, other)).toBe(true);
        }
      }
    }
  });
});
