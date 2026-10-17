/**
 * **The confetti repro** — Law 2, *a body stays whole*, under a clashing drop.
 *
 * Greg reported this four times between 2026-10-03 and 2026-10-06, most
 * precisely on the last: *"if I move a node — especially one with multiple
 * child trees — and even one of those end-nodes clashes with an existing node,
 * we get confetti across the whole family unit being moved. Then when picking
 * up and dragging that same family to a faraway area, the confetti doesn't
 * rectify, even with auto-arrange."*
 *
 * It resisted reproduction for a week. Two things hid it, and both are worth
 * knowing before changing anything here.
 *
 * **1. A drop onto empty ground is always clean.** Every earlier attempt
 * translated a large branch into open space, which `placeIsland` answers with
 * `fits` — a cell-by-cell translation that cannot break anything. The fault
 * needs the branch to *overlap* somebody, and the map is now spaced so
 * generously that overlap has to be aimed for.
 *
 * **2. "The largest child of the root" is the wrong branch.** These fixtures
 * put one pass-through unit under the root, so that branch *is* the whole
 * company and there is nothing outside it to collide with. Greg's own was
 * Everest Region — 1,258 of Northwind's 2,957 units, four rungs down, and
 * exactly the move count his saved arrangement held. His arrangement was that
 * one branch moved.
 *
 * ### What it does
 *
 * Measured here on the 1,000-person company, over 484 drop targets that
 * genuinely overlap, with today's code:
 *
 * | where the governing node lands | outcome |
 * | --- | --- |
 * | on a free cell | `parted` or `nudged` 293 + 157, **`gathered` 11** |
 * | **on an occupied cell** | **`gathered` 22 of 23** |
 *
 * `gathered` is the confetti: the branch is re-laid from scratch and whole
 * families inside it fall from **224/248 to about 80/248**. So it is not
 * random — it is overwhelmingly *dropping the node you are holding directly
 * onto an occupied tile*, which is the natural way to say "put this over
 * there". And it is unrecoverable by dragging again, because once the shape is
 * gone a later clean drop faithfully translates the broken shape.
 *
 * ### What this means for the rules
 *
 * A draft rule set proposed stopping `groupOf` *and* `gapBetween` being passed
 * to the drop path, as "two deletions, not rewrites". The measurement splits
 * them:
 *
 * | `placeIsland` given | clashing landing | whole families |
 * | --- | --- | --- |
 * | `groupOf` + `gapBetween` (today) | `parted` | 224/248 |
 * | `groupOf` only | `parted` | 224/248 |
 * | neither | **`gathered` always** | **73–99/248** |
 *
 * `gapBetween` is the harmful half and goes. **`groupOf` is the only thing
 * standing between a clashing drop and confetti** — deleting it would have
 * caused the very fault the rule was written to fix. What it needs is to
 * *become* the territory rather than a flat team id. See `docs/MAP-LAWS.md`.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { branchOf, placeIsland, type IslandLanding } from "@/lib/map/layout/hex/arrange";
import { cellKey, neighbours, type Cell } from "@/lib/map/layout/hex/coords";
import { layoutTerritories } from "@/lib/map/layout/hex/territory";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";

import { buildLabCompany } from "./company";

/**
 * How many of a branch's families are one connected patch, counted from the
 * cells actually drawn.
 *
 * Never from the layout's own statistics: the `allocation` memo in `HexLab`
 * replaces the cells and spreads the *calculated* layout's figures through
 * untouched, which on 2026-10-06 had the panel reporting 91% cohesion about a
 * map nobody was looking at while Greg could see named people adrift.
 */
function wholeFamilies(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  scope: ReadonlySet<string>,
): { families: number; whole: number } {
  let families = 0;
  let whole = 0;
  for (const id of scope) {
    const unit = tree.units.get(id);
    const own = cells.get(id);
    if (!unit || !own || unit.childIds.length === 0) continue;
    families++;

    const patch = new Set([cellKey(own)]);
    for (const childId of unit.childIds) {
      const c = cells.get(childId);
      if (c) patch.add(cellKey(c));
    }
    const seen = new Set([cellKey(own)]);
    const stack: Cell[] = [own];
    while (stack.length) {
      const at = stack.pop()!;
      for (const nb of neighbours(at)) {
        const key = cellKey(nb);
        if (patch.has(key) && !seen.has(key)) { seen.add(key); stack.push(nb); }
      }
    }
    if (seen.size === patch.size) whole++;
  }
  return { families, whole };
}

describe("a dragged branch landing on occupied ground", () => {
  let tree: OrbitalTree;
  let base: ReturnType<typeof layoutTerritories>;
  let branch: Set<string>;
  let anchorId: string;
  let groupOf: (id: string) => string;
  /** Every drop target whose translation genuinely overlaps somebody else. */
  const clashing: { target: Cell; anchorOccupied: boolean }[] = [];
  let clean = { families: 0, whole: 0 };

  const drop = (target: Cell, opts: { withGroups: boolean }) => {
    const members = new Map<string, Cell>();
    for (const id of branch) {
      const c = base.cells.get(id);
      if (c) members.set(id, c);
    }
    const landing: IslandLanding = placeIsland(
      new Map(base.occupants), members, anchorId, target,
      (id) => tree.units.get(id)?.childIds ?? [],
      opts.withGroups ? groupOf : undefined,
    );
    const cells = new Map(base.cells);
    if (landing.kind !== "no-room") for (const [id, c] of landing.cells) cells.set(id, c);
    return { landing, cells };
  };

  beforeAll(() => {
    const { org, groups, leads } = buildLabCompany("large", "people");
    tree = buildOrbitalTree(org, { mergePassThroughRoot: false, workCountFor: () => 6 });
    const groupMap = new Map(groups);
    groupOf = (id) => groupMap.get(id) ?? id;
    base = layoutTerritories(tree, {
      leads: new Set(leads), people: new Set(groups.map(([id]) => id)),
    });

    // A big branch that still leaves a company around it — see the header.
    const want = tree.units.size * 0.4;
    let score = Infinity;
    anchorId = tree.rootId;
    for (const unit of tree.units.values()) {
      if (unit.id === tree.rootId) continue;
      const gap = Math.abs(branchOf(tree, unit.id).size - want);
      if (gap < score) { score = gap; anchorId = unit.id; }
    }
    branch = branchOf(tree, anchorId);
    clean = wholeFamilies(tree, base.cells, branch);

    const own = base.cells.get(anchorId)!;
    const outside = new Set(
      [...base.occupants].filter(([, id]) => !branch.has(id)).map(([key]) => key),
    );
    const mine = [...branch]
      .map((id) => base.cells.get(id))
      .filter((c): c is Cell => !!c);

    for (let dq = -40; dq <= 40; dq += 2) {
      for (let dr = -40; dr <= 40; dr += 2) {
        let hit = 0;
        for (const c of mine) {
          if (outside.has(cellKey({ q: c.q + dq, r: c.r + dr }))) { hit++; break; }
        }
        if (!hit) continue;
        const target = { q: own.q + dq, r: own.r + dr };
        clashing.push({ target, anchorOccupied: outside.has(cellKey(target)) });
      }
    }
  });

  it("has clashing targets to test, including some on an occupied tile", () => {
    expect(clashing.length).toBeGreaterThan(50);
    expect(clashing.filter((c) => c.anchorOccupied).length).toBeGreaterThan(0);
  });

  it("never puts two units on one cell — Law 1 has no exception clause", () => {
    for (const { target } of clashing.slice(0, 40)) {
      for (const withGroups of [true, false]) {
        const { cells } = drop(target, { withGroups });
        const seen = new Set<string>();
        let buried = 0;
        for (const cell of cells.values()) {
          const key = cellKey(cell);
          if (seen.has(key)) buried++;
          seen.add(key);
        }
        expect(buried, `(${target.q},${target.r}) groupOf=${withGroups}`).toBe(0);
      }
    }
  });

  it("knows what travels as one body, or every clashing drop is confetti", () => {
    // The half of the proposed deletion that must NOT happen. Without
    // `groupOf`, a clash cannot be answered by stepping a group aside, so the
    // whole branch is re-laid and most of its families come apart.
    // Stated over the sample rather than per target: a drop that happens to
    // find room nearby with its shape intact (`nudged`) is not a failure, it
    // just is not the case under test. What must hold is that losing `groupOf`
    // turns clashing drops into re-laid branches, and that re-laying one costs
    // most of its families.
    // **Stated as the comparison it means, not as a count.** It was a count —
    // "more than half this sample comes back `gathered`" — and that is a fact
    // about one layout's geometry rather than about `groupOf`. The compass
    // (`headings` in `territory.ts`) changed where everything sits, so the
    // same scan returned different targets and the count moved, while the
    // thing being defended had not changed at all. What must hold is the
    // delta: taking `groupOf` away is what turns a clash into a re-laid
    // branch, and a re-laid branch loses most of its families.
    const sample = clashing.slice(0, 12);
    let reLaidWithout = 0;
    let reLaidWith = 0;
    for (const { target } of sample) {
      const without = drop(target, { withGroups: false });
      const with_ = drop(target, { withGroups: true });
      if (with_.landing.kind === "gathered") reLaidWith++;
      if (without.landing.kind !== "gathered") continue;
      reLaidWithout++;
      const after = wholeFamilies(tree, without.cells, branch);
      expect(after.whole, `(${target.q},${target.r})`).toBeLessThan(clean.whole / 2);
    }
    expect(reLaidWithout, "clashing drops re-laid without groupOf").toBeGreaterThan(0);
    expect(
      reLaidWithout,
      `re-laid without groupOf (${reLaidWithout}) vs with it (${reLaidWith})`,
    ).toBeGreaterThan(reLaidWith);
  });

  /**
   * **The fault itself, stated as the law it breaks.**
   *
   * `it.fails` passes while the body throws, so the suite stays honest without
   * staying green about something broken. When the drop path learns
   * territories this will start failing — that is the signal to change it to
   * `it` and delete this note.
   */
  it.fails("Law 2: a clashing drop keeps the branch whole, wherever it lands", () => {
    for (const { target } of clashing) {
      const { cells } = drop(target, { withGroups: true });
      const after = wholeFamilies(tree, cells, branch);
      // A clash may cost a family or two as groups step aside. It may not cost
      // two thirds of them.
      expect(after.whole, `(${target.q},${target.r})`)
        .toBeGreaterThan(clean.whole * 0.9);
    }
  });

  it("breaks mostly where the held node lands on an occupied tile", () => {
    // The characterisation that makes the fault predictable rather than
    // mysterious, and the thing to re-measure after a fix.
    let brokenOnOccupied = 0, occupied = 0;
    let brokenOnFree = 0, free = 0;
    for (const { target, anchorOccupied } of clashing) {
      const { landing } = drop(target, { withGroups: true });
      const broken = landing.kind === "gathered";
      if (anchorOccupied) { occupied++; if (broken) brokenOnOccupied++; }
      else { free++; if (broken) brokenOnFree++; }
    }
    expect(occupied).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
    /**
     * **Stated as the contrast, because the absolute rate has already moved
     * once — downward, and not from a fix aimed at it.**
     *
     * When this was written the reading was 22 of 23 occupied-anchor drops
     * breaking against 11 of 450 on free ground. The compass in `territory.ts`
     * then changed where everything sits, and the same scan now finds **6 of 11
     * against 2 of 1,107** — the fault halved, and landing on free ground went
     * from one in forty to one in five hundred, which is the atlas being easier
     * to drop into rather than the drop path being any wiser.
     *
     * So the number to hold is the ratio between the two, not either one. The
     * thing this test exists to say is that **the held node landing on somebody
     * is what breaks a branch**, and that it is not drops in general.
     */
    const onOccupied = brokenOnOccupied / occupied;
    const onFree = brokenOnFree / free;
    expect(onOccupied, `${brokenOnOccupied}/${occupied} occupied`).toBeGreaterThan(0.4);
    expect(onFree, `${brokenOnFree}/${free} free`).toBeLessThan(0.05);
    expect(onOccupied).toBeGreaterThan(onFree * 10);
  });
});
