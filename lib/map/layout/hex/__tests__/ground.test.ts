import { describe, expect, it } from "vitest";

import { cellKey, type Cell } from "../coords";
import { groundAt, holderOf } from "../ground";

/**
 * A three-rung company, laid out by hand so every case below is a picture
 * rather than a fixture:
 *
 *   company  at (0,0)
 *   team     at (3,0)   — far enough that its ground never touches the company
 *   ana      at (3,1)   — in the team, so her hexagon sits inside the team's
 */
const CELLS: Record<string, Cell> = {
  company: { q: 0, r: 0 },
  team: { q: 3, r: 0 },
  ana: { q: 3, r: 1 },
};

const occupants = new Map(Object.entries(CELLS).map(([id, cell]) => [cellKey(cell), id]));

const DEPTH: Record<string, number> = { company: 0, team: 1, ana: 2 };
const PARENT: Record<string, string | null> = { company: null, team: "company", ana: "team" };

const depthOf = (id: string) => DEPTH[id] ?? 0;
const parentOf = (id: string) => PARENT[id] ?? null;
const isPerson = (id: string) => id === "ana";

const where = (cell: Cell) => groundAt({ cell, occupants, depthOf });

describe("whose ground a cell is on", () => {
  it("says nobody when somebody is standing there — that is a question about them", () => {
    expect(where(CELLS.team)).toBeNull();
    expect(where(CELLS.ana)).toBeNull();
  });

  it("gives a vacant cell beside a team to that team", () => {
    // (2,0) touches the team and nothing else.
    expect(where({ q: 2, r: 0 })).toEqual({ unitId: "team", ring: 1 });
  });

  it("gives open paper to nobody", () => {
    expect(where({ q: -9, r: 4 })).toBeNull();
  });

  it("lets the innermost zone win where they nest", () => {
    // (2,1) touches both the team and Ana. Hers is the inner hexagon.
    const found = where({ q: 2, r: 1 });
    expect(found).toEqual({ unitId: "ana", ring: 1 });
  });

  it("reaches two rings out, but only once the first ring has nobody in it", () => {
    // (3,-2) is two from the team, three from Ana and three from the company,
    // so the team's outer ring is the only zone it is in.
    expect(where({ q: 3, r: -2 })).toEqual({ unitId: "team", ring: 2 });
  });

  it("prefers the nearer unit over the deeper one", () => {
    // (4,1) touches Ana (depth 2) and is two rings from the company (depth 0).
    // Ring beats depth: the first hexagon is somebody's own space.
    expect(where({ q: 4, r: 1 })).toEqual({ unitId: "ana", ring: 1 });
  });

  it("answers the same way every time where two equals are the same distance", () => {
    const two = new Map([
      [cellKey({ q: 0, r: 0 }), "zoe"],
      [cellKey({ q: 2, r: 0 }), "abe"],
    ]);
    const between = { q: 1, r: 0 };
    const flat = () => 1;
    const first = groundAt({ cell: between, occupants: two, depthOf: flat });
    const reversed = new Map([...two].reverse());
    expect(first).toEqual({ unitId: "abe", ring: 1 });
    expect(groundAt({ cell: between, occupants: reversed, depthOf: flat })).toEqual(first);
  });
});

describe("what a thing made on that ground belongs to", () => {
  it("puts it in the team whose ground you clicked", () => {
    expect(holderOf({ ground: { unitId: "team", ring: 1 }, parentOf, isPerson })).toBe("team");
  });

  it("puts it in a person's team, not under the person", () => {
    // Greg: "creates inside that team by default". Reporting to Ana is what
    // double-clicking Ana herself is for.
    expect(holderOf({ ground: { unitId: "ana", ring: 1 }, parentOf, isPerson })).toBe("team");
  });

  it("puts it alongside the team when you are in the group's ring", () => {
    expect(holderOf({ ground: { unitId: "team", ring: 2 }, parentOf, isPerson })).toBe("company");
  });

  it("counts a person's outer ring from their team, not from them", () => {
    expect(holderOf({ ground: { unitId: "ana", ring: 2 }, parentOf, isPerson })).toBe("company");
  });

  it("has nothing to belong to outside the company itself", () => {
    expect(holderOf({ ground: { unitId: "company", ring: 2 }, parentOf, isPerson })).toBeNull();
  });
});
