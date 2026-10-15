/**
 * Territories inside territories (Greg, 2026-10-03).
 *
 * *"We need to gently push for the whole thing to render with more visual
 * organisation."*
 *
 * The properties here are the ones that make an atlas an atlas: a unit's ground
 * holds its whole subtree, nobody stands on anybody, and the same company comes
 * out the same way every time. The numbers that follow them are measured rather
 * than aimed at, and they are the trade this arrangement makes against the
 * archipelago it sits beside.
 */
import { describe, expect, it } from "vitest";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { allocateByTerritory, headings, layoutTerritories, rotate, nearestDirection, MAX_HALO, SIBLING_GAP } from "@/lib/map/layout/hex/territory";
import { DIRECTIONS, cellKey, hexDistance, type Cell } from "@/lib/map/layout/hex/coords";

const treeOf = (people: number, maxDepth: number): OrbitalTree => {
  const org = buildDeepOrg("hexlab", { people, maxDepth, seed: 7 });
  return buildOrbitalTree(
    {
      units: org.units.map((u) => ({ id: u.id, name: u.name, parentId: u.parentId ?? null, leadPersonId: u.leadPersonId ?? null })),
      people: org.people.map((p) => ({ id: p.id, name: p.name })),
      assignments: org.assignments.map((a) => ({ personId: a.personId, orgUnitId: a.orgUnitId, allocationPct: a.allocationPct ?? 100 })),
    },
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
};

/** Every unit below `id`, however deep. */
const descendants = (tree: OrbitalTree, id: string): string[] => {
  const out: string[] = [];
  const stack = [...(tree.units.get(id)?.childIds ?? [])];
  while (stack.length) {
    const at = stack.pop()!;
    out.push(at);
    stack.push(...(tree.units.get(at)?.childIds ?? []));
  }
  return out;
};

describe("turning a territory", () => {
  /**
   * The whole reason a territory can be measured facing one way and placed
   * facing another. A hex lattice maps onto itself under a sixth of a turn, so
   * this is exact — no rounding, no drift, no cell landing between cells.
   */
  it("maps each of the six directions onto the next, exactly", () => {
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 6; k++) {
        expect(rotate(DIRECTIONS[i], k)).toEqual(DIRECTIONS[(i + k) % 6]);
      }
    }
  });

  it("comes back to where it started after a full turn", () => {
    for (const cell of [{ q: 3, r: -7 }, { q: -11, r: 4 }, { q: 0, r: 0 }]) {
      expect(rotate(cell, 6)).toEqual(cell);
    }
  });

  it("keeps every distance, because a rotation is not a stretch", () => {
    const a = { q: 4, r: -9 };
    const b = { q: -2, r: 5 };
    for (let k = 0; k < 6; k++) {
      expect(hexDistance(rotate(a, k), rotate(b, k))).toBe(hexDistance(a, b));
    }
  });

  it("names the direction a step most nearly points along", () => {
    for (let i = 0; i < 6; i++) expect(nearestDirection(DIRECTIONS[i])).toBe(i);
    // Three steps east is still east.
    expect(nearestDirection({ q: 3, r: 0 })).toBe(0);
  });
});

describe("a company laid out as an atlas", () => {
  const sizes = [[45, 4], [1000, 8]] as const;

  it("gives every unit a cell, and no two units the same one", () => {
    for (const [people, depth] of sizes) {
      const tree = treeOf(people, depth);
      const laid = layoutTerritories(tree);
      expect(laid.cells.size).toBe(tree.units.size);
      expect(new Set([...laid.cells.values()].map(cellKey)).size).toBe(tree.units.size);
      expect(laid.stats.tooClose).toBe(0);
    }
  });

  /** The property the whole idea rests on: a division is somewhere you can
   *  point at, because everything under it is inside its ground. */
  it("holds every descendant inside its own ground", () => {
    for (const [people, depth] of sizes) {
      const tree = treeOf(people, depth);
      const laid = layoutTerritories(tree);
      for (const unit of tree.units.values()) {
        const region = laid.regions.get(unit.id);
        if (!region) continue;
        for (const id of descendants(tree, unit.id)) {
          const cell = laid.cells.get(id);
          if (!cell) continue;
          expect(hexDistance(cell, region.centre)).toBeLessThanOrEqual(region.radius);
        }
      }
    }
  });

  /**
   * Greg, 2026-10-03: *"sibling teams by default have one tile separating
   * them."* Between *territories* — a child that brings a subtree with it. A
   * lone node is not yet a place and may sit against its kin, which is what
   * keeps a family a family.
   */
  it("leaves a clear tile between sibling territories, but not between lone nodes", () => {
    const tree = treeOf(1000, 8);
    const laid = layoutTerritories(tree);
    let apart = 0;
    let checked = 0;
    for (const unit of tree.units.values()) {
      const kids = unit.childIds.filter((id) => (tree.units.get(id)?.childIds.length ?? 0) > 0);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = laid.regions.get(kids[i]);
          const b = laid.regions.get(kids[j]);
          if (!a || !b) continue;
          checked++;
          // Their nodes, at least, must not be touching.
          const one = laid.cells.get(kids[i])!;
          const two = laid.cells.get(kids[j])!;
          if (hexDistance(one, two) > SIBLING_GAP) apart++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(apart).toBe(checked);
  });

  /** The standing requirement that has held since the first day of this study:
   *  the picture is a pure function of the company. Not a numbered law — see
   *  `docs/MAP-LAWS.md`. */
  it("gives the same company the same cells, every time and in any order", () => {
    const tree = treeOf(1000, 8);
    const once = layoutTerritories(tree);
    const again = layoutTerritories(tree);
    for (const [id, cell] of once.cells) expect(again.cells.get(id)).toEqual(cell);

    // The same company with its units arriving in the opposite order.
    const org = buildDeepOrg("hexlab", { people: 1000, maxDepth: 8, seed: 7 });
    const reversed = buildOrbitalTree(
      {
        units: [...org.units].reverse().map((u) => ({ id: u.id, name: u.name, parentId: u.parentId ?? null, leadPersonId: u.leadPersonId ?? null })),
        people: org.people.map((p) => ({ id: p.id, name: p.name })),
        assignments: org.assignments.map((a) => ({ personId: a.personId, orgUnitId: a.orgUnitId, allocationPct: a.allocationPct ?? 100 })),
      },
      { mergePassThroughRoot: false, workCountFor: () => 6 },
    );
    const other = layoutTerritories(reversed);
    for (const [id, cell] of once.cells) expect(other.cells.get(id)).toEqual(cell);
  });

  /**
   * What the arrangement actually buys and costs, on the 2,562-person company,
   * against the archipelago it sits beside. Measured, with room under each
   * number — they are here so a change that quietly undoes one of them has to
   * argue for itself.
   */
  it("measures up against the archipelago", () => {
    const tree = treeOf(2400, 11);
    const atlas = allocateByTerritory(tree, { maxGap: 3 });
    const children = atlas.stats.placed - 1;
    /**
     * **85% sit where the rule put them**, which is the number that means
     * something now. Raw adjacency to a parent is *down* to 53% and that is the
     * tier rule working rather than a regression: above team level a unit is
     * deliberately held off its parent, so counting those as failures would be
     * counting the feature. `connected` asks the honest question — is anything
     * further out than it was told to be.
     */
    expect(atlas.stats.connected / children).toBeGreaterThan(0.8);
    // Nothing is ever placed offshore — nesting replaces the archipelago rule.
    expect(atlas.stats.islands).toBe(0);
    expect(atlas.stats.placed).toBe(tree.units.size);
  });

  /**
   * Greg, 2026-10-03: *"at the highest level of abstraction, the greatest
   * number of hexagon tiles are found between nodes. At the lowest level of
   * abstraction, the team level, each team should by default group together…
   * and exist with a bubble of 1 tile around it… for every level of
   * abstraction, add 1 additional tile-spacing rule between nodes."*
   */
  it("gives the master centre room and leaves the team level snug", () => {
    const tree = treeOf(2400, 11);
    // An explicit cap: `MAX_HALO` is a design decision, and a test
    // that moves with it is not holding anything.
    const laid = layoutTerritories(tree, { maxGap: 3 });
    const root = tree.units.get(tree.rootId)!;
    const centre = laid.cells.get(root.id)!;

    // The top of the company gets the widest streets on the map.
    for (const id of root.childIds) {
      const cell = laid.cells.get(id);
      if (cell) expect(hexDistance(cell, centre)).toBeGreaterThan(2);
    }

    // The bottom of it gets none: a unit whose children are individuals keeps
    // them pressed against it, or a team stops reading as one thing.
    let snug = 0, teams = 0;
    for (const unit of tree.units.values()) {
      if (unit.childIds.length === 0) continue;
      const kidsAreLeaves = unit.childIds.every(
        (id) => (tree.units.get(id)?.childIds.length ?? 0) === 0);
      if (!kidsAreLeaves) continue;
      teams++;
      const own = laid.cells.get(unit.id)!;
      if (unit.childIds.every((id) => {
        const c = laid.cells.get(id);
        return !c || hexDistance(c, own) === 1;
      })) snug++;
    }
    expect(teams).toBeGreaterThan(50);
    expect(snug / teams).toBeGreaterThan(0.9);

    // And the spacing a unit was held at never exceeds the cap it was given.
    for (const by of laid.spacedBy.values()) expect(by).toBeLessThanOrEqual(3);
  });

  /** `buildOrbitalTree` invents a root for an empty company rather than
   *  returning nothing, so this is a company of one, at the origin. */
  /**
   * **Everybody gets a cell, in the configuration that nearly lost 26 of them.**
   *
   * With people promoted to units the tree is deep enough for the high tiers to
   * earn real bubbles, and the ring walk skips everything inside a bubble — but
   * the reach that bounds that walk did not account for it. A high-tier unit
   * with a small first child had every candidate skipped, came back with
   * nothing, and the child was **dropped from the map without a word**: 2,931
   * units placed out of 2,957, visible only as a count that did not add up.
   *
   * `unplaced` exists so that can never be silent again, and this is the shape
   * that exercises it.
   */
  it("seats every unit when the tree is deep enough to earn bubbles", () => {
    // A deep chain of single children, each ending in a small team — exactly
    // the case that starves: high tier above, tiny child below.
    const units: { id: string; name: string; parentId: string | null; leadPersonId: string | null }[] =
      [{ id: "root", name: "Root", parentId: null, leadPersonId: null }];
    let at = "root";
    for (let rung = 0; rung < 9; rung++) {
      const id = `rung${rung}`;
      units.push({ id, name: id, parentId: at, leadPersonId: null });
      // A team of four hanging off each rung, so every rung is a real place.
      for (let k = 0; k < 4; k++) {
        units.push({ id: `${id}-p${k}`, name: `${id}-p${k}`, parentId: id, leadPersonId: null });
      }
      at = id;
    }
    const tree = buildOrbitalTree({ units, people: [], assignments: [] }, {
      mergePassThroughRoot: false, workCountFor: () => 6,
    });
    const laid = layoutTerritories(tree);
    expect(laid.stats.unplaced).toBe(0);
    expect(laid.cells.size).toBe(tree.units.size);
    expect(new Set([...laid.cells.values()].map(cellKey)).size).toBe(tree.units.size);
  });

  /**
   * Greg, 2026-10-03: *"yes, I said nodes… but I also mean people/teams too —
   * with the exception of team leads."*
   *
   * So the halo turns away a child's **whole territory**, people and all,
   * rather than merely holding its node at a distance — and the unit's own lead
   * walks straight through it.
   */
  describe("the halo round a high node", () => {
    /** A root with a lead and two sizeable reports, each with a team under it,
     *  so the root earns a real tier. */
    const company = () => {
      const units: { id: string; name: string; parentId: string | null; leadPersonId: string | null }[] =
        [{ id: "root", name: "Root", parentId: null, leadPersonId: null },
         { id: "chief", name: "Chief", parentId: "root", leadPersonId: null }];
      for (const side of ["a", "b"]) {
        units.push({ id: side, name: side, parentId: "root", leadPersonId: null });
        for (let r = 0; r < 3; r++) {
          units.push({ id: `${side}-t${r}`, name: `${side}-t${r}`, parentId: side, leadPersonId: null });
          for (let p = 0; p < 5; p++) {
            units.push({ id: `${side}-t${r}-p${p}`, name: `p`, parentId: `${side}-t${r}`, leadPersonId: null });
          }
        }
      }
      return buildOrbitalTree({ units, people: [], assignments: [] }, {
        mergePassThroughRoot: false, workCountFor: () => 6,
      });
    };

    it("turns away a whole territory, not just the node at its head", () => {
      const tree = company();
      const laid = layoutTerritories(tree, { maxGap: 4, leads: new Set(["chief"]) });
      const centre = laid.cells.get("root")!;
      const bubble = Math.max(0, (laid.spacedBy.get("a") ?? 0));
      expect(bubble).toBeGreaterThan(0);
      // Nothing of either report's subtree — its people included — may stand
      // inside the halo.
      for (const [id, cell] of laid.cells) {
        if (id === "root" || id === "chief") continue;
        expect(hexDistance(cell, centre)).toBeGreaterThan(bubble);
      }
    });

    it("lets the unit's own lead through it", () => {
      const tree = company();
      const laid = layoutTerritories(tree, { maxGap: 4, leads: new Set(["chief"]) });
      const centre = laid.cells.get("root")!;
      expect(hexDistance(laid.cells.get("chief")!, centre)).toBe(1);
    });

    it("keeps the lead outside when it is not marked as one", () => {
      const tree = company();
      const laid = layoutTerritories(tree, { maxGap: 4 });
      const centre = laid.cells.get("root")!;
      expect(hexDistance(laid.cells.get("chief")!, centre)).toBeGreaterThan(1);
    });

    it("seats everybody however wide the halo gets", () => {
      const tree = company();
      for (const maxGap of [0, 2, 6, Infinity]) {
        const laid = layoutTerritories(tree, { maxGap, leads: new Set(["chief"]) });
        expect(laid.stats.unplaced).toBe(0);
        expect(laid.cells.size).toBe(tree.units.size);
        expect(new Set([...laid.cells.values()].map(cellKey)).size).toBe(tree.units.size);
      }
    });
  });

  /**
   * **The cap must not reach down into the companies anybody demonstrates.**
   *
   * `MAX_HALO` is a design decision — 12, chosen on 2026-10-14 for load time,
   * against a rule that would otherwise settle at a halo of 119 on the largest
   * company. It is allowed to shape the top of a big map. It is not allowed to
   * be the thing deciding gaps on Sparrow Jam or Digital Tailoring, which is
   * where every map change is checked: if it ever does, the demo companies have
   * stopped showing what the spacing rule actually does.
   */
  it("never decides a gap on the two demo companies", () => {
    for (const [people, maxDepth] of [[10, 2], [45, 4]] as const) {
      const laid = layoutTerritories(treeOf(people, maxDepth));
      const widest = Math.max(0, ...laid.spacedBy.values());
      expect(widest, `${people} people / ${maxDepth} rungs`).toBeLessThan(MAX_HALO);
    }
  });

  /**
   * How far down the cap reaches on the biggest company, pinned so a change is
   * visible rather than silent. At 48 it clipped 1 unit here; at 12 it reaches
   * further, which is the width Greg traded for the 4.7× speedup.
   */
  it("clips only the top of the largest company, and says how far", () => {
    const laid = layoutTerritories(treeOf(2400, 11));
    const clipped = [...laid.spacedBy.values()].filter((v) => v >= MAX_HALO);
    expect(clipped.length).toBeLessThanOrEqual(12);
  });

  it("does not fall over on a company with no units", () => {
    const empty = buildOrbitalTree({ units: [], people: [], assignments: [] }, {
      mergePassThroughRoot: false, workCountFor: () => 6,
    });
    const laid = layoutTerritories(empty);
    expect(laid.cells.size).toBe(1);
    expect([...laid.cells.values()][0]).toEqual({ q: 0, r: 0 });
  });

  it("puts a company of one at the origin", () => {
    const one = buildOrbitalTree(
      { units: [{ id: "a", name: "A", parentId: null, leadPersonId: null }], people: [], assignments: [] },
      { mergePassThroughRoot: false, workCountFor: () => 6 },
    );
    const laid = layoutTerritories(one);
    expect(laid.cells.get("a")).toEqual({ q: 0, r: 0 } satisfies Cell);
  });
});

describe("Law 3 — children sit outward, and the compass is how", () => {
  const org = buildDeepOrg("law3", { people: 600, maxDepth: 7, seed: 11 });
  const tree = buildOrbitalTree(org);

  it("gives every unit a bearing, and none to argue with", () => {
    const compass = headings(tree);
    for (const unit of tree.units.values()) {
      expect(compass.get(unit.id), unit.name).toBeTypeOf("number");
      expect(compass.get(unit.id)).toBeGreaterThanOrEqual(0);
      expect(compass.get(unit.id)).toBeLessThan(6);
    }
  });

  it("costs nothing to work out — it is the shape of the company, not geometry", () => {
    // It runs before a single cell is packed, so it may not consult a layout.
    const t = performance.now();
    for (let i = 0; i < 20; i++) headings(tree);
    expect((performance.now() - t) / 20).toBeLessThan(50);
  });

  it("is the same answer every time, like the layout it feeds", () => {
    const a = headings(tree);
    const b = headings(tree);
    for (const [id, dir] of a) expect(b.get(id)).toBe(dir);
  });

  /**
   * **The number Law 3 owes the panel.**
   *
   * Greg, 2026-10-14: *"we're getting quite a lot of loopback on connection
   * lines still."* The lines were never the fault — 95% of them were already
   * dead straight. What loops is where things sit: a third of all units stood
   * nearer the master centre than their own parent, so the line home had to
   * come back inward.
   *
   * Before the compass this was 32–35% on every company. A bare majority would
   * be a coin toss, so the bar is set where it cannot pass by accident and
   * still leaves room for the cases the laws above it win: Law 2 keeps a body
   * whole first, and a leaf is held to its parent's doorstep whichever side
   * that is on.
   */
  it("leaves few units nearer the centre than their own parent", () => {
    const laid = layoutTerritories(tree);
    const centre = laid.cells.get(tree.rootId)!;
    let kids = 0;
    let curled = 0;
    for (const unit of tree.units.values()) {
      if (!unit.parentId) continue;
      const own = laid.cells.get(unit.id);
      const up = laid.cells.get(unit.parentId);
      if (!own || !up) continue;
      kids++;
      if (hexDistance(own, centre) < hexDistance(up, centre)) curled++;
    }
    expect(kids).toBeGreaterThan(100);
    expect(curled / kids).toBeLessThan(0.2);
  });

  /**
   * **The guard on the win above.** A bearing is easy to satisfy if you are
   * allowed to put everybody wherever it points, and the result would be a map
   * that reads outward and has stopped being a family tree.
   *
   * The bar is just under what this fixture gives, because what matters is that
   * the figure does not *move*: measured at **59.6% with the compass and 59.6%
   * without it** — identical — so the curl-back win cost no cohesion at all
   * here. (It is low in absolute terms because this fixture is team-level and
   * small, where half the units are structural nodes rather than places. The
   * companies in the lab, with people as the smallest unit, sit at 86–87%, and
   * that figure also held across the change.)
   */
  it("is not bought by scattering families — Law 2 outranks Law 3", () => {
    const laid = layoutTerritories(tree);
    let kids = 0;
    let touching = 0;
    for (const unit of tree.units.values()) {
      if (!unit.parentId) continue;
      const own = laid.cells.get(unit.id);
      if (!own) continue;
      kids++;
      const kin = new Set<string>();
      const up = laid.cells.get(unit.parentId);
      if (up) kin.add(cellKey(up));
      for (const sib of tree.units.get(unit.parentId)?.childIds ?? []) {
        if (sib === unit.id) continue;
        const c = laid.cells.get(sib);
        if (c) kin.add(cellKey(c));
      }
      for (const d of DIRECTIONS) {
        if (kin.has(cellKey({ q: own.q + d.q, r: own.r + d.r }))) { touching++; break; }
      }
    }
    expect(touching / kids).toBeGreaterThan(0.55);
  });
});
