/**
 * **What a double-click offers** — the decisions Greg made on 2026-10-21,
 * pinned so the next change to the menu is a deliberate one.
 */
import { describe, expect, it } from "vitest";
import { menuFor, type Spot } from "@/app/lab/hex/menu";

const nameOf = (id: string) => ({ team: "Dune Team", ana: "Ana", top: "Northwind" }[id] ?? id);
const labels = (spot: Spot) => menuFor(spot, nameOf).map((i) => i.label);

describe("double-clicking ground", () => {
  it("offers a person and a team, and nothing else, on open paper", () => {
    expect(labels({ kind: "make", holder: null })).toEqual(["A person", "A team"]);
  });

  it("names whose ground it is, so the new thing's home is read rather than asked", () => {
    expect(labels({ kind: "make", holder: "team" })).toEqual([
      "A person in Dune Team",
      "A team in Dune Team",
      "Something on its own",
    ]);
  });

  it("makes things belong to the ground, and only the last item escape it", () => {
    const actions = menuFor({ kind: "make", holder: "team" }, nameOf).map((i) => i.action);
    expect(actions).toEqual([
      { do: "make", kind: "person", where: "holder" },
      { do: "make", kind: "place", where: "holder" },
      { do: "make", kind: "place", where: "island" },
    ]);
  });

  it("has nothing to be apart from on open paper, so does not offer it", () => {
    const actions = menuFor({ kind: "make", holder: null }, nameOf).map((i) => i.action);
    expect(actions.every((a) => a.do === "make" && a.where === "island")).toBe(true);
  });
});

describe("double-clicking a node", () => {
  const node = (over: Partial<Extract<Spot, { kind: "node" }>> = {}): Spot => ({
    kind: "node", unitId: "ana", isRoot: false, isBorn: true, hasRoom: true, ...over,
  });

  it("describes it first — the commonest thing, and what Miro does", () => {
    expect(labels(node())[0]).toBe("Describe Ana…");
  });

  it("opens the wizard for a node made here, and a rename for one that came with the company", () => {
    expect(menuFor(node(), nameOf)[0].action).toEqual({ do: "describe" });
    expect(menuFor(node({ isBorn: false }), nameOf)[0].action).toEqual({ do: "rename" });
  });

  it("offers the thing that cannot be done by pointing", () => {
    // A child goes in a cell and you can point at the cell. A parent is a
    // rung, so this menu is the only place it can be asked for.
    expect(labels(node())).toContain("Something above Ana");
  });

  it("will not put anything above the company, or remove it", () => {
    expect(labels(node({ unitId: "top", isRoot: true }))).toEqual([
      "Describe Northwind…",
      "Someone under Northwind",
    ]);
  });

  it("does not offer a child where there is nowhere to put one", () => {
    expect(labels(node({ hasRoom: false }))).not.toContain("Someone under Ana");
  });

  it("keeps removing apart from the rest, and marks it", () => {
    const items = menuFor(node(), nameOf);
    const last = items[items.length - 1];
    expect(last.action).toEqual({ do: "remove" });
    expect(last.danger).toBe(true);
  });
});
