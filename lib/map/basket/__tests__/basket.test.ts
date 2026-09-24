import { describe, expect, it } from "vitest";
import { addToBasket, carrierOf, isCarried, returnFromBasket, type Basket, type BasketTree } from "../basket";

// co ─┬─ div ─┬─ teamA ── squadA1
//     │       └─ teamB
//     └─ other
const parents: Record<string, string | null> = {
  co: null,
  div: "co",
  teamA: "div",
  squadA1: "teamA",
  teamB: "div",
  other: "co",
};
const tree: BasketTree = {
  parentOf: (id) => parents[id] ?? null,
  nameOf: (id) => id.toUpperCase(),
};

describe("the edge basket", () => {
  it("adds a unit as a pending carry", () => {
    const result = addToBasket([], "teamA", tree);
    expect(result.outcome).toBe("added");
    expect(result.basket).toEqual([{ unitId: "teamA", absorbed: [] }]);
  });

  it("holds several unrelated branches at once", () => {
    let basket: Basket = [];
    basket = addToBasket(basket, "teamA", tree).basket;
    basket = addToBasket(basket, "other", tree).basket;
    expect(basket.map((e) => e.unitId)).toEqual(["teamA", "other"]);
  });

  it("never takes the same unit twice", () => {
    const basket = addToBasket([], "teamA", tree).basket;
    const again = addToBasket(basket, "teamA", tree);
    expect(again.outcome).toBe("already");
    expect(again.basket).toBe(basket);
  });

  it("refuses a unit its ancestor's entry already carries", () => {
    const basket = addToBasket([], "div", tree).basket;
    const inside = addToBasket(basket, "squadA1", tree);
    expect(inside).toEqual({ outcome: "inside", basket, carrierId: "div" });
  });

  it("absorbs descendants already in the basket when their ancestor is added", () => {
    let basket: Basket = [];
    basket = addToBasket(basket, "squadA1", tree).basket;
    basket = addToBasket(basket, "teamB", tree).basket;
    basket = addToBasket(basket, "other", tree).basket;
    const result = addToBasket(basket, "div", tree);
    expect(result.outcome).toBe("absorbed");
    if (result.outcome !== "absorbed") return;
    expect(result.basket.map((e) => e.unitId)).toEqual(["other", "div"]);
    expect(result.absorbed.sort()).toEqual(["SQUADA1", "TEAMB"]);
    expect(result.basket.find((e) => e.unitId === "div")!.absorbed.sort()).toEqual(["SQUADA1", "TEAMB"]);
  });

  it("keeps the story when an absorbing entry is itself absorbed", () => {
    let basket: Basket = addToBasket([], "squadA1", tree).basket;
    basket = addToBasket(basket, "teamA", tree).basket;
    const result = addToBasket(basket, "div", tree);
    expect(result.basket).toEqual([{ unitId: "div", absorbed: ["TEAMA", "SQUADA1"] }]);
  });

  it("will not carry the company off its own map", () => {
    expect(addToBasket([], "co", tree).outcome).toBe("refused");
  });

  it("knows which entry carries a unit, and when nothing does", () => {
    const basket = addToBasket([], "teamA", tree).basket;
    expect(carrierOf(basket, "squadA1", tree)).toBe("teamA");
    expect(carrierOf(basket, "teamA", tree)).toBe("teamA");
    expect(isCarried(basket, "teamB", tree)).toBe(false);
  });

  it("returns an entry without touching anything else", () => {
    let basket: Basket = addToBasket([], "teamA", tree).basket;
    basket = addToBasket(basket, "other", tree).basket;
    expect(returnFromBasket(basket, "teamA")).toEqual([{ unitId: "other", absorbed: [] }]);
    expect(returnFromBasket([], "teamA")).toEqual([]);
  });
});
