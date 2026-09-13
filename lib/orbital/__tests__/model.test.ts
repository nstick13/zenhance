import { describe, it, expect } from "vitest";
import { buildOrbitalTree, unitsAtDepth } from "../model";
import { demoInput } from "./orbitalFixture";

describe("buildOrbitalTree", () => {
  it("merges a pass-through root so the company sits at the centre of its own org", () => {
    const tree = buildOrbitalTree(demoInput());
    const root = tree.units.get(tree.rootId)!;
    expect(root.name).toBe("Digital Tailoring"); // the company keeps its name…
    expect(tree.units.has("delivery")).toBe(false); // …and absorbs the holding node
    expect(root.childIds.sort()).toEqual(["atlas", "infosys", "orion", "vega"]);
  });

  it("keeps the absorbed node's people, rehomed onto the centre", () => {
    const tree = buildOrbitalTree(demoInput());
    const root = tree.units.get(tree.rootId)!;
    const names = root.seatIds.map((id) => tree.seats.get(id)!.name);
    expect(names).toContain("Sarah Reeve");
    expect(tree.seats.get(root.seatIds[0])!.unitId).toBe(tree.rootId);
  });

  it("leaves the root alone when it genuinely has several children", () => {
    const input = demoInput();
    input.units.push({ id: "ops", name: "Operations", parentId: "company" });
    const tree = buildOrbitalTree(input);
    expect(tree.rootId).toBe("company");
    expect(tree.units.has("delivery")).toBe(true);
  });

  it("seats a unit's lead on that unit even with no assignment there", () => {
    const tree = buildOrbitalTree(demoInput());
    const atlas = tree.units.get("atlas")!;
    const seats = atlas.seatIds.map((id) => tree.seats.get(id)!);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ name: "Aimee Bradford", kind: "lead" });
  });

  it("puts humans on every rung, not just the leaves", () => {
    const tree = buildOrbitalTree(demoInput());
    const depthsWithPeople = new Set(
      [...tree.seats.values()].map((s) => tree.units.get(s.unitId)!.depth),
    );
    expect(depthsWithPeople.has(0)).toBe(true); // the company's own director
    expect(depthsWithPeople.has(1)).toBe(true); // stream leads
    expect(depthsWithPeople.has(2)).toBe(true); // team members
  });

  it("marks a supporter as shared on every seat they hold", () => {
    const tree = buildOrbitalTree(demoInput());
    const marcus = [...tree.seats.values()].filter((s) => s.personId === "marcus");
    expect(marcus).toHaveLength(2);
    for (const seat of marcus) expect(seat.shared).toBe(true);
  });

  it("does not promote an assigned lead to a second seat on their own team", () => {
    const tree = buildOrbitalTree(demoInput());
    const starlight = tree.units.get("starlight")!;
    const tomSeats = starlight.seatIds
      .map((id) => tree.seats.get(id)!)
      .filter((s) => s.personId === "tom");
    expect(tomSeats).toHaveLength(1);
    expect(tomSeats[0].kind).toBe("lead"); // the assignment is what carries them
  });

  it("keeps open roles as their own seats", () => {
    const tree = buildOrbitalTree(demoInput());
    const open = [...tree.seats.values()].filter((s) => s.kind === "open");
    expect(open).toHaveLength(1);
    expect(open[0].personId).toBeNull();
    expect(open[0].unitId).toBe("earthlight");
  });

  it("counts headcount up the tree", () => {
    const tree = buildOrbitalTree(demoInput());
    const atlas = tree.units.get("atlas")!;
    const root = tree.units.get(tree.rootId)!;
    // Atlas: its own lead + Starlight's four + Moonlight's two.
    expect(atlas.totalSeats).toBe(7);
    expect(root.totalSeats).toBeGreaterThan(atlas.totalSeats);
  });

  it("gives a busier subtree more angular pull", () => {
    const tree = buildOrbitalTree(demoInput());
    expect(tree.units.get("atlas")!.weight).toBeGreaterThan(tree.units.get("infosys")!.weight);
  });

  it("reports the rungs it actually has", () => {
    const tree = buildOrbitalTree(demoInput());
    expect(tree.maxDepth).toBe(2);
    expect(unitsAtDepth(tree, 1).map((u) => u.name).sort()).toEqual([
      "Atlas",
      "Infosys Contractors",
      "Orion",
      "Vega",
    ]);
  });

  it("attaches work items when the caller supplies them", () => {
    const tree = buildOrbitalTree(demoInput(), { workCountFor: (id) => (id === "ana" ? 5 : 0) });
    const anaSeats = [...tree.seats.values()].filter((s) => s.personId === "ana");
    expect(anaSeats.length).toBeGreaterThan(0);
    for (const seat of anaSeats) expect(seat.workCount).toBe(5);
  });

  it("treats a unit whose parent is missing from the snapshot as a root", () => {
    const input = demoInput();
    input.units.push({ id: "orphan", name: "Orphan", parentId: "not-in-snapshot" });
    const tree = buildOrbitalTree(input);
    expect(tree.units.has("orphan")).toBe(true);
    expect(tree.units.get("orphan")!.depth).toBe(1); // hung off a synthetic centre
  });

  it("is deterministic", () => {
    const a = buildOrbitalTree(demoInput());
    const b = buildOrbitalTree(demoInput());
    expect([...a.units.keys()]).toEqual([...b.units.keys()]);
    expect([...a.seats.keys()]).toEqual([...b.seats.keys()]);
  });
});
