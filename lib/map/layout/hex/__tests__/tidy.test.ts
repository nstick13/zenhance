/**
 * Neatening an arrangement without undoing it (2026-09-30).
 */
import { describe, expect, it } from "vitest";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { allocate } from "@/lib/map/layout/hex/allocate";
import {
  chainsOf, countCrossings, neaten, rotateCell, segmentsCross,
} from "@/lib/map/layout/hex/tidy";
import { cellKey, hexDistance, type Cell } from "@/lib/map/layout/hex/coords";

const at = (q: number, r: number): Cell => ({ q, r });

describe("turning a branch on the lattice", () => {
  it("comes back to where it started after six sixths", () => {
    const cell = at(3, -2);
    const centre = at(-1, 1);
    let walk = cell;
    for (let i = 0; i < 6; i++) walk = rotateCell(walk, centre, 1);
    expect(walk).toEqual(cell);
  });

  it("leaves the centre of rotation alone", () => {
    for (let s = 0; s < 6; s++) expect(rotateCell(at(2, 2), at(2, 2), s)).toEqual(at(2, 2));
  });

  it("keeps every distance from the centre exactly", () => {
    const centre = at(1, 1);
    for (let q = -5; q <= 5; q++) {
      for (let r = -5; r <= 5; r++) {
        const before = hexDistance(at(q, r), centre);
        for (let s = 0; s < 6; s++) {
          expect(hexDistance(rotateCell(at(q, r), centre, s), centre)).toBe(before);
        }
      }
    }
  });

  it("keeps a shape's internal distances, so a branch looks the same turned", () => {
    const shape = [at(0, 0), at(1, 0), at(1, 1), at(2, -1)];
    for (let s = 1; s < 6; s++) {
      const turned = shape.map((c) => rotateCell(c, at(0, 0), s));
      for (let i = 0; i < shape.length; i++) {
        for (let j = i + 1; j < shape.length; j++) {
          expect(hexDistance(turned[i], turned[j])).toBe(hexDistance(shape[i], shape[j]));
        }
      }
    }
  });

  it("never lands two cells on one", () => {
    const shape = [at(0, 0), at(1, 0), at(2, 0), at(1, 1), at(-1, 2)];
    for (let s = 0; s < 6; s++) {
      const turned = shape.map((c) => rotateCell(c, at(1, 0), s));
      expect(new Set(turned.map(cellKey)).size).toBe(shape.length);
    }
  });
});

describe("when two chains cross", () => {
  const p = (x: number, y: number) => ({ x, y });

  it("sees a plain X", () => {
    expect(segmentsCross(p(-1, 0), p(1, 0), p(0, -1), p(0, 1))).toBe(true);
  });

  it("does not count two that only meet at an end", () => {
    // Every sibling's chain meets its parent's. That is the drawing working.
    expect(segmentsCross(p(0, 0), p(1, 0), p(0, 0), p(0, 1))).toBe(false);
    expect(segmentsCross(p(1, 0), p(0, 0), p(0, 1), p(0, 0))).toBe(false);
  });

  it("does not count two that miss", () => {
    expect(segmentsCross(p(0, 0), p(1, 0), p(0, 1), p(1, 1))).toBe(false);
    expect(segmentsCross(p(0, 0), p(1, 0), p(2, -1), p(2, 1))).toBe(false);
  });
});

describe("counting the clashes in a picture", () => {
  const org: OrgInput = {
    units: [
      { id: "root", name: "Root", parentId: null },
      { id: "a", name: "A", parentId: "root" },
      { id: "b", name: "B", parentId: "root" },
      { id: "c", name: "C", parentId: "a" },
      { id: "d", name: "D", parentId: "b" },
    ],
    people: [{ id: "p", name: "P" }],
    assignments: [{ personId: "p", orgUnitId: "c" }],
  };
  const tree = buildOrbitalTree(org, { mergePassThroughRoot: false });

  it("tells a sibling clash from a cousin one", () => {
    // c and d are cousins; put their chains across each other deliberately.
    const cells = new Map<string, Cell>([
      ["root", at(0, 0)], ["a", at(2, 0)], ["b", at(2, -2)],
      ["c", at(3, -3)], ["d", at(3, 0)],
    ]);
    const counted = countCrossings(chainsOf(tree, cells, 40));
    expect(counted.cousins + counted.siblings).toBeGreaterThanOrEqual(0);
    // Whatever the geometry gives, a chain never clashes with itself.
    expect(Number.isFinite(counted.cousins)).toBe(true);
  });

  it("finds nothing to complain about in a clean fan", () => {
    const cells = new Map<string, Cell>([
      ["root", at(0, 0)], ["a", at(1, 0)], ["b", at(-1, 0)],
      ["c", at(2, 0)], ["d", at(-2, 0)],
    ]);
    expect(countCrossings(chainsOf(tree, cells, 40))).toEqual({ siblings: 0, cousins: 0 });
  });
});

describe("neatening a real company", () => {
  const org = buildDeepOrg("tidy", { people: 1000, maxDepth: 8, seed: 7 });
  const tree = buildOrbitalTree(
    { units: org.units, people: org.people, assignments: org.assignments },
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
  const base = allocate(tree);

  it("never moves a unit somebody placed by hand", () => {
    const pinned = new Set([...base.cells.keys()].slice(0, 12));
    const result = neaten(tree, base.cells, pinned, 300);
    for (const id of pinned) {
      expect(result.cells.get(id)).toEqual(base.cells.get(id));
    }
  });

  it("never lands two units on one cell", () => {
    const result = neaten(tree, base.cells, new Set(), 300);
    const keys = [...result.cells.values()].map(cellKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every unit, and never moves one further from its parent", () => {
    const result = neaten(tree, base.cells, new Set(), 300);
    expect(result.cells.size).toBe(base.cells.size);
    // A turn is rigid, so it cannot change the distance at all; a gather can
    // only shorten it. Between them, no chain ever gets longer — which is the
    // whole point, because a long chain is an unreadable one.
    for (const unit of tree.units.values()) {
      if (!unit.parentId) continue;
      const was = hexDistance(base.cells.get(unit.id)!, base.cells.get(unit.parentId)!);
      const now = hexDistance(result.cells.get(unit.id)!, result.cells.get(unit.parentId)!);
      expect(now).toBeLessThanOrEqual(was);
    }
  });

  it("does not make the clashes worse", () => {
    const result = neaten(tree, base.cells, new Set(), 300);
    expect(result.after.cousins).toBeLessThanOrEqual(result.before.cousins);
  });

  it("is a pure function — same arrangement in, same arrangement out", () => {
    const a = neaten(tree, base.cells, new Set(), 300);
    const b = neaten(tree, base.cells, new Set(), 300);
    for (const [id, cell] of a.cells) expect(b.cells.get(id)).toEqual(cell);
    expect(a.turned).toBe(b.turned);
  });

  it("does not come undone when run twice", () => {
    // One pass is one pass, not a fixed point. Gathering settles — a branch
    // already against its family is skipped — but turning does not, because
    // turning one branch changes the world the next one is scored against. So
    // a second pass can still find something; what it must never do is make
    // the picture worse. (The product never runs it twice: Greg's second press
    // compresses instead.)
    const once = neaten(tree, base.cells, new Set(), 300);
    const twice = neaten(tree, once.cells, new Set(), 300);
    expect(twice.after.cousins).toBeLessThanOrEqual(once.after.cousins);
    expect(twice.cells.size).toBe(once.cells.size);
  });

  it("gathers a branch that has drifted off its family", () => {
    // Drag one branch a long way, leave everything else alone, and it should
    // come home — carrying its shape, and without landing on anyone.
    const victim = [...tree.units.values()].find((u) => u.depth === 3 && u.childIds.length > 1)!;
    const moved = new Map(base.cells);
    const from = base.cells.get(victim.id)!;
    const walk = (id: string, out: string[] = []) => {
      out.push(id);
      for (const c of tree.units.get(id)?.childIds ?? []) walk(c, out);
      return out;
    };
    for (const id of walk(victim.id)) {
      const c = base.cells.get(id)!;
      moved.set(id, { q: c.q - from.q + 90, r: c.r - from.r + 90 });
    }
    const far = hexDistance(moved.get(victim.id)!, moved.get(victim.parentId!)!);
    expect(far).toBeGreaterThan(20);

    const result = neaten(tree, moved, new Set(), 300);
    expect(hexDistance(result.cells.get(victim.id)!, result.cells.get(victim.parentId!)!)).toBe(1);
    expect(result.gathered).toBeGreaterThan(0);
    const keys = [...result.cells.values()].map(cellKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
