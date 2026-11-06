/**
 * **Making one thing must not move everything else** — the re-lay flinch,
 * found on 2026-10-21 and fixed on 2026-10-30.
 *
 * The figures in `hand.ts` are the ones this reproduces: Sparrow Jam, five
 * units, one node made inside Granite Division, and four of the five units
 * standing somewhere different afterwards. The engine's own behaviour is not
 * the bug and is asserted here too — it is *supposed* to re-derive the map
 * from the tree — so the test holds both halves: the engine still re-lays, and
 * the lab no longer lets it.
 */
import { describe, expect, it } from "vitest";
import { buildLabCompany } from "@/app/lab/hex/company";
import { applyHand, settle } from "@/app/lab/hex/hand";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { allocateByTerritory } from "@/lib/map/layout/hex/territory";
import { cellKey, hexDistance, ring, type Cell } from "@/lib/map/layout/hex/coords";

/** The lab's own pipeline, in the order `HexLab` runs it. */
function lay(org: OrgInput, people: Set<string>, moves?: Map<string, Cell>) {
  const tree = buildOrbitalTree(org, { mergePassThroughRoot: false, workCountFor: () => 6 });
  const base = allocateByTerritory(tree, { people, driver: "radial", sideways: "forbid" });
  const hand = moves?.size ? applyHand(base.cells, moves) : null;
  return { tree, cells: hand?.cells ?? base.cells, occupants: hand?.occupants ?? base.occupants };
}

/**
 * **Sparrow Jam as the lab builds it: 27 units, every person one of them.**
 *
 * It was five units until 2026-11-06, when the teams strata came off the lab
 * and a person became the smallest unit everywhere (Greg: *"on hex, the
 * smallest unit should always be people"*). The numbers below moved with it,
 * and the flinch they describe did not: a company this size still re-lays
 * around one new node, which is the whole reason `settle` exists.
 */
function sparrow() {
  const { org, groups } = buildLabCompany("small");
  const people = new Set(groups.map(([id]) => id));
  const clean = lay(org, people);
  // The unit the bug was found on: one more child here takes the ring
  // schedule from [0,2] to [0,3,5].
  const host = [...clean.tree.units.values()].find((u) => u.name === "Granite Division")!;
  const home = clean.cells.get(host.id)!;
  let at: Cell | null = null;
  for (let r = 1; r <= 8 && !at; r++) {
    for (const c of ring(home, r)) if (!clean.occupants.has(cellKey(c))) { at = c; break; }
  }
  return { org, people, clean, host, at: at! };
}

/** A node made inside `host`, exactly as `makeNode` builds one. */
const withNode = (org: OrgInput, hostId: string, id = "born"): OrgInput =>
  ({ ...org, units: [...org.units, { id, name: "", parentId: hostId, leadPersonId: null }] });

/** How many units that were already on the map are standing somewhere else. */
function stirred(before: ReadonlyMap<string, Cell>, after: ReadonlyMap<string, Cell>) {
  let moved = 0, worst = 0;
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) continue;
    const d = hexDistance(was, now);
    if (d > 0) { moved += 1; worst = Math.max(worst, d); }
  }
  return { moved, worst, of: before.size };
}

/**
 * **The flinch, and where it went** (rewritten 2026-11-06).
 *
 * This block used to open by proving the fault: on the five-unit Sparrow Jam
 * of the teams strata, making one node inside Granite Division moved four of
 * the five units, up to five cells. The map went from 2,814 × 2,837 world
 * units to 4,452 × 4,098. That is the fault `settle` was built for on
 * 2026-10-30, and the full account of it is in the doc comment on `settle`
 * itself, which is where it belongs.
 *
 * **It is no longer reproducible from this lab, and that is a finding rather
 * than a fix.** The flinch was arithmetic about *smallness* — a sixth unit is
 * a fifth of a five-unit company, enough to take the ring schedule in
 * `radial.ts` from `[0,2]` to `[0,3,5]` and re-seat every rung outside it.
 * With a person as the smallest unit everywhere, the smallest company the lab
 * can show is 27 units, and at that size one more node changes no schedule and
 * moves nothing at all. Measured the day the strata came off: **nought of 27
 * moved on Sparrow Jam**, where the five-unit shape moved four of five.
 *
 * So what these two tests now assert is the *stability*, not the fault. They
 * are still worth running: they are what would notice the engine starting to
 * flinch again at a size somebody is actually looking at. `settle`'s own
 * promise is tested below, and does not depend on either of them.
 */
describe("the engine, on the companies the lab can show", () => {
  it("does not re-lay the smallest company around one new node", () => {
    const { org, people, clean, host } = sparrow();
    const grown = lay(withNode(org, host.id), people);
    const { moved, of } = stirred(clean.cells, grown.cells);
    expect(of).toBe(27);
    expect(moved).toBe(0);
  });

  it("nor a company twenty times the size", () => {
    const { org, groups } = buildLabCompany("medium");
    const people = new Set(groups.map(([id]) => id));
    const clean = lay(org, people);
    const host = [...clean.tree.units.values()]
      .filter((u) => !people.has(u.id) && u.parentId)
      .sort((a, b) => b.totalSeats - a.totalSeats)[0];
    const grown = lay(withNode(org, host.id), people);
    const { moved, of } = stirred(clean.cells, grown.cells);
    // A handful at most, and in practice none. The ceiling is kept rather than
    // pinned to nought because this is the engine's own answer to a different
    // tree, and it is entitled to move a tile without that being a fault.
    expect(moved / of).toBeLessThan(0.1);
  });
});

describe("settle keeps the map where it is", () => {
  it("leaves every unit on its own cell when a node is made", () => {
    const { org, people, clean, host, at } = sparrow();
    // What `placeBorn` now does: settle everything, then put the new node down.
    const moves = settle(clean.cells, new Map()).set("born", at);
    const grown = lay(withNode(org, host.id), people, moves);
    expect(stirred(clean.cells, grown.cells).moved).toBe(0);
  });

  it("puts the new node exactly where it was made", () => {
    const { org, people, clean, host, at } = sparrow();
    const moves = settle(clean.cells, new Map()).set("born", at);
    const grown = lay(withNode(org, host.id), people, moves);
    expect(grown.cells.get("born")).toEqual(at);
  });

  it("holds for a second node, and a third", () => {
    const { org, people, clean, host, at } = sparrow();
    let grown = { ...clean };
    let shape = org;
    let moves = new Map<string, Cell>();
    let next: Cell = at;
    for (const id of ["born1", "born2", "born3"]) {
      moves = settle(grown.cells, moves).set(id, next);
      shape = withNode(shape, host.id, id);
      grown = lay(shape, people, moves);
      expect(stirred(clean.cells, grown.cells).moved).toBe(0);
      expect(grown.cells.get(id)).toEqual(next);
      next = ring(next, 1).find((c) => !grown.occupants.has(cellKey(c)))!;
    }
    // All three are still on the map, each on its own cell.
    expect(new Set([...grown.cells.values()].map(cellKey)).size).toBe(grown.cells.size);
  });

  it("leaves the map where it is when a branch is removed", () => {
    const { org, people, clean } = sparrow();
    /**
     * **A leaf, which on the people strata means a person.**
     *
     * This used to remove a team by name, "Union Team 1", and that was a clean
     * removal while a team was a cell with seats orbiting it. Now that every
     * person is a unit in their own right, taking a team out from under its
     * people orphans them — `buildOrbitalTree` has to find them a new parent,
     * which is a different company rather than the same one minus a branch, and
     * one of them honestly moves. Removing a leaf is the gesture this test is
     * about: nothing else in the tree changes shape.
     */
    const parents = new Set([...clean.tree.units.values()].map((u) => u.parentId));
    const doomed = [...clean.tree.units.values()]
      .find((u) => u.parentId && !parents.has(u.id))!;
    const moves = settle(clean.cells, new Map());
    moves.delete(doomed.id);
    const pruned: OrgInput = { ...org, units: org.units.filter((u) => u.id !== doomed.id) };
    const after = lay(pruned, people, moves);
    expect(after.cells.has(doomed.id)).toBe(false);
    expect(stirred(clean.cells, after.cells).moved).toBe(0);
  });
});

describe("a cell is taken only if the unit on it is staying", () => {
  /**
   * **The third-node bug, 2026-11-06.** `applyHand` walked the placements in
   * order and refused any whose cell was occupied at that moment, so a chain —
   * A wants B's cell, B wants C's — was broken wherever the order happened to
   * visit it. It showed up as the map moving when you made the third thing, on
   * every company: five of Sparrow Jam's 27 units, up to ten cells away; three
   * of 110 on Digital Tailoring; one of 1,273 on the thousand-person company.
   * Every refusal was a cell whose holder was itself moving away.
   */
  it("honours a chain of placements, whatever order they arrive in", () => {
    const laid = new Map<string, Cell>([
      ["a", { q: 0, r: 0 }], ["b", { q: 1, r: 0 }], ["c", { q: 2, r: 0 }],
    ]);
    // a→b's cell, b→c's cell, c→somewhere free. Nothing here conflicts; it
    // only looks like it does if you ask one placement at a time.
    const moves = new Map<string, Cell>([
      ["a", { q: 1, r: 0 }], ["b", { q: 2, r: 0 }], ["c", { q: 3, r: 0 }],
    ]);
    const { cells } = applyHand(laid, moves);
    expect(cells.get("a")).toEqual({ q: 1, r: 0 });
    expect(cells.get("b")).toEqual({ q: 2, r: 0 });
    expect(cells.get("c")).toEqual({ q: 3, r: 0 });
  });

  it("honours a cycle, where no cell is ever free", () => {
    const laid = new Map<string, Cell>([["a", { q: 0, r: 0 }], ["b", { q: 1, r: 0 }]]);
    const moves = new Map<string, Cell>([["a", { q: 1, r: 0 }], ["b", { q: 0, r: 0 }]]);
    const { cells } = applyHand(laid, moves);
    expect(cells.get("a")).toEqual({ q: 1, r: 0 });
    expect(cells.get("b")).toEqual({ q: 0, r: 0 });
  });

  it("still refuses a cell held by somebody standing still, and cascades", () => {
    // c is not moving, so b cannot have its cell; that makes b stay, so a
    // cannot have b's cell either. Both keep what the engine gave them.
    const laid = new Map<string, Cell>([
      ["a", { q: 0, r: 0 }], ["b", { q: 1, r: 0 }], ["c", { q: 2, r: 0 }],
    ]);
    const moves = new Map<string, Cell>([
      ["a", { q: 1, r: 0 }], ["b", { q: 2, r: 0 }],
    ]);
    const { cells, occupants } = applyHand(laid, moves);
    expect(cells.get("a")).toEqual({ q: 0, r: 0 });
    expect(cells.get("b")).toEqual({ q: 1, r: 0 });
    expect(cells.get("c")).toEqual({ q: 2, r: 0 });
    expect(occupants.size).toBe(3);
  });

  it("gives one cell to one unit when two placements claim it", () => {
    const laid = new Map<string, Cell>([
      ["a", { q: 0, r: 0 }], ["b", { q: 1, r: 0 }], ["c", { q: 5, r: 0 }],
    ]);
    const moves = new Map<string, Cell>([
      ["a", { q: 9, r: 0 }], ["b", { q: 9, r: 0 }],
    ]);
    const { cells, occupants } = applyHand(laid, moves);
    expect(cells.get("a")).toEqual({ q: 9, r: 0 });
    expect(cells.get("b")).toEqual({ q: 1, r: 0 });
    expect(occupants.size).toBe(3);
  });

  it("is injective on every company the lab can show", () => {
    for (const key of ["small", "medium"] as const) {
      const { org, groups } = buildLabCompany(key);
      const people = new Set(groups.map(([id]) => id));
      const clean = lay(org, people);
      // Settle the whole map, then shuffle every placement one cell over —
      // the hardest case there is, because every cell is wanted by somebody.
      const moves = new Map<string, Cell>();
      for (const [id, c] of clean.cells) moves.set(id, { q: c.q + 1, r: c.r });
      const { cells } = applyHand(clean.cells, moves);
      const keys = new Set([...cells.values()].map(cellKey));
      expect(keys.size).toBe(cells.size);
    }
  });
});

describe("settle is honest about what it writes", () => {
  it("keeps what is on the screen, not what the engine last thought", () => {
    const laid = new Map<string, Cell>([["a", { q: 0, r: 0 }], ["b", { q: 1, r: 0 }]]);
    // A stale placement: b's saved cell belongs to a, so `applyHand` refuses it.
    const stale = new Map<string, Cell>([["b", { q: 0, r: 0 }]]);
    const { cells } = applyHand(laid, stale);
    expect(cells.get("b")).toEqual({ q: 1, r: 0 });
    // Settling writes the visible cell over the refused one rather than
    // carrying a placement that can never land.
    expect(settle(cells, stale).get("b")).toEqual({ q: 1, r: 0 });
  });

  it("stays injective, so nothing can land on top of anything", () => {
    const { clean } = sparrow();
    const out = settle(clean.cells, new Map([["ghost", { q: 0, r: 0 }]]));
    const seen = new Set([...clean.cells.keys()].map((id) => cellKey(out.get(id)!)));
    expect(seen.size).toBe(clean.cells.size);
  });

  it("writes nothing for a root nobody can point at", () => {
    // On blank paper, and on any company with several things at the top, the
    // tree builder synthesises a root. It stands on a cell, so settling would
    // save a placement for it — one no hand ever made, and one that outlives
    // the shape that needed it.
    const cells = new Map<string, Cell>([["root", { q: 0, r: 0 }], ["a", { q: 1, r: 0 }]]);
    const out = settle(cells, new Map(), "root");
    expect([...out.keys()]).toEqual(["a"]);
    expect(settle(cells, new Map()).size).toBe(2);
  });

  it("does not drop a placement for something the layout has never heard of", () => {
    // A node made on blank paper is in `moves` before it is anywhere else.
    const out = settle(new Map(), new Map([["born", { q: 2, r: -1 }]]));
    expect(out.get("born")).toEqual({ q: 2, r: -1 });
  });
});
