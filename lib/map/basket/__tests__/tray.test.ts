import { describe, expect, it } from "vitest";
import { addToBasket, type Basket, type BasketTree } from "../basket";
import {
  DRAG_THRESHOLD,
  TRAY_SLACK,
  carriedBranch,
  carriedRoots,
  carryTold,
  isDragging,
  noRoomNotice,
  overTray,
} from "../tray";

const RECT = { left: 900, right: 1000, top: 200, bottom: 600 };

describe("overTray", () => {
  it("is true inside", () => {
    expect(overTray({ x: 950, y: 400 }, RECT)).toBe(true);
  });

  it("is true just outside, so a thumb at the edge still counts", () => {
    expect(overTray({ x: 900 - TRAY_SLACK + 1, y: 400 }, RECT)).toBe(true);
    expect(overTray({ x: 950, y: 600 + TRAY_SLACK - 1 }, RECT)).toBe(true);
  });

  it("is false beyond the slack", () => {
    expect(overTray({ x: 900 - TRAY_SLACK - 5, y: 400 }, RECT)).toBe(false);
    expect(overTray({ x: 950, y: 200 - TRAY_SLACK - 5 }, RECT)).toBe(false);
  });

  it("is false with nothing to test against — no tray mounted, no pointer", () => {
    expect(overTray(null, RECT)).toBe(false);
    expect(overTray({ x: 950, y: 400 }, null)).toBe(false);
  });
});

describe("tap or drag", () => {
  const start = { x: 100, y: 100 };

  it("is a tap while the finger barely moves", () => {
    expect(isDragging(start, { x: 102, y: 101 })).toBe(false);
    expect(isDragging(start, start)).toBe(false);
  });

  it("becomes a drag once it travels", () => {
    expect(isDragging(start, { x: 100 + DRAG_THRESHOLD, y: 100 })).toBe(true);
    expect(isDragging(start, { x: 120, y: 130 })).toBe(true);
  });

  it("measures distance, not axis", () => {
    // A diagonal wobble of 4px per axis is 5.66 of travel — still a tap,
    // even though a per-axis check at 4 would have called it a drag.
    expect(isDragging(start, { x: 104, y: 104 })).toBe(false);
    expect(isDragging(start, { x: 105, y: 105 })).toBe(true); // 7.07
  });
});

describe("carriedBranch", () => {
  //  a ─ b ─ d
  //    └ c
  const children: Record<string, string[]> = { a: ["b", "c"], b: ["d"], c: [], d: [] };
  const childrenOf = (id: string) => children[id] ?? [];
  const basket = (...ids: string[]): Basket => ids.map((unitId) => ({ unitId, absorbed: [] }));

  it("is empty for an empty basket", () => {
    expect(carriedBranch([], childrenOf).size).toBe(0);
  });

  it("carries everything below an entry", () => {
    expect([...carriedBranch(basket("a"), childrenOf)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("carries only that branch", () => {
    expect([...carriedBranch(basket("b"), childrenOf)].sort()).toEqual(["b", "d"]);
  });

  it("does not loop forever on a cyclic tree", () => {
    const cyclic = (id: string) => (id === "x" ? ["y"] : ["x"]);
    expect([...carriedBranch(basket("x"), cyclic)].sort()).toEqual(["x", "y"]);
  });

  it("reports the entries themselves separately", () => {
    expect([...carriedRoots(basket("a", "z"))].sort()).toEqual(["a", "z"]);
  });
});

describe("what the map says", () => {
  //  root ─ delivery ─ platform ─ payments
  const parents: Record<string, string | null> = {
    root: null, delivery: "root", platform: "delivery", payments: "platform", billing: "platform",
  };
  const names: Record<string, string> = {
    root: "Northwind", delivery: "Delivery", platform: "Platform",
    payments: "Payments", billing: "Billing",
  };
  const tree: BasketTree = {
    parentOf: (id) => parents[id] ?? null,
    nameOf: (id) => names[id] ?? "This unit",
  };
  const told = (basket: Basket, id: string) => carryTold(addToBasket(basket, id, tree), id, tree);

  it("says how to use it the first time", () => {
    const { notice, flash } = told([], "payments");
    expect(notice).toContain("Carrying Payments");
    expect(notice).toContain("drag it out of the basket");
    expect(flash).toBeNull();
  });

  it("explains an absorption, naming what moved", () => {
    const one = addToBasket([], "payments", tree).basket;
    const { notice } = told(one, "platform");
    expect(notice).toBe("Payments is now carried inside Platform's branch.");
  });

  it("uses a plural verb for more than one absorbed unit", () => {
    let b = addToBasket([], "payments", tree).basket;
    b = addToBasket(b, "billing", tree).basket;
    const { notice } = told(b, "platform");
    expect(notice).toContain("are now carried inside Platform's branch");
    expect(notice).toContain("Payments");
    expect(notice).toContain("Billing");
  });

  it("points at the entry when the unit is already in the basket", () => {
    const b = addToBasket([], "payments", tree).basket;
    const { notice, flash } = told(b, "payments");
    expect(notice).toBe("Payments is already in the basket.");
    expect(flash).toBe("payments");
  });

  it("points at the carrier when an ancestor already has it", () => {
    const b = addToBasket([], "platform", tree).basket;
    const { notice, flash } = told(b, "payments");
    expect(notice).toBe("Payments is already carried with Platform's branch.");
    // The entry to light is the *carrier*, not the unit that was grabbed —
    // otherwise the notice points at a chip that is not in the tray.
    expect(flash).toBe("platform");
  });

  it("refuses the company kindly", () => {
    const { notice, flash } = told([], "root");
    expect(notice).toContain("centre of its own map");
    expect(flash).toBeNull();
  });

  it("says where a branch went when there was no room for it", () => {
    expect(noRoomNotice("Payments")).toContain("still in the basket");
  });
});
