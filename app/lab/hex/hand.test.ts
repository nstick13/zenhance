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

/** Sparrow Jam as the lab builds it: five units, nobody drawn as a person. */
function sparrow() {
  const { org, groups } = buildLabCompany("small", "teams");
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

describe("the flinch itself", () => {
  it("is real: the engine re-lays a five-unit company around one new node", () => {
    const { org, people, clean, host } = sparrow();
    const grown = lay(withNode(org, host.id), people);
    const { moved, worst, of } = stirred(clean.cells, grown.cells);
    expect(of).toBe(5);
    // Four of five, up to five cells away. This is the engine doing its job on
    // a different tree, which is why the fix is not in the engine.
    expect(moved).toBeGreaterThanOrEqual(4);
    expect(worst).toBeGreaterThanOrEqual(4);
  });

  it("is a small-company effect, not a general one", () => {
    const { org, groups } = buildLabCompany("medium", "people");
    const people = new Set(groups.map(([id]) => id));
    const clean = lay(org, people);
    const host = [...clean.tree.units.values()]
      .filter((u) => !people.has(u.id) && u.parentId)
      .sort((a, b) => b.totalSeats - a.totalSeats)[0];
    const grown = lay(withNode(org, host.id), people);
    const { moved, of } = stirred(clean.cells, grown.cells);
    // Same gesture, a company 20× the size: a handful of units at most. The
    // 45-person map is where this stops being visible.
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
    const doomed = [...clean.tree.units.values()].find((u) => u.name === "Union Team 1")!;
    const moves = settle(clean.cells, new Map());
    moves.delete(doomed.id);
    const pruned: OrgInput = { ...org, units: org.units.filter((u) => u.id !== doomed.id) };
    const after = lay(pruned, people, moves);
    expect(after.cells.has(doomed.id)).toBe(false);
    expect(stirred(clean.cells, after.cells).moved).toBe(0);
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
