/**
 * The edge basket — for carrying branches across a large map (Greg,
 * 2026-09-21).
 *
 * Dropping a unit in the basket stores a *pending carry*. Nothing is saved:
 * not a position, not a relationship. The unit's branch stays drawn where it
 * lives, marked as carried, while the user pans, zooms and focuses freely;
 * dragging the entry back out onto the map is an ordinary drop.
 *
 * The rules are about branches. A unit always travels with everything below
 * it, so:
 *
 *   - a unit can only be in the basket once;
 *   - a unit whose ancestor is already in the basket is already being
 *     carried, and cannot be added separately;
 *   - adding an ancestor of units already in the basket absorbs them into
 *     its entry — they are included with that branch.
 *
 * Pure state in, state out, so the rules are tested apart from the tray.
 */

export type BasketEntry = {
  unitId: string;
  /** Names of units that were in the basket separately and are now carried
   *  inside this entry's branch — so the tray can say where they went. */
  absorbed: string[];
};

export type Basket = readonly BasketEntry[];

export type BasketTree = {
  parentOf: (unitId: string) => string | null;
  nameOf: (unitId: string) => string;
};

export type AddResult =
  | { outcome: "added"; basket: Basket }
  | { outcome: "absorbed"; basket: Basket; absorbed: string[] }
  | { outcome: "already"; basket: Basket }
  /** An ancestor already in the basket carries this unit. */
  | { outcome: "inside"; basket: Basket; carrierId: string }
  /** The company itself cannot be carried off its own map. */
  | { outcome: "refused"; basket: Basket };

/** The entry that carries a unit — the unit's own, or an ancestor's. */
export function carrierOf(basket: Basket, unitId: string, tree: BasketTree): string | null {
  const inBasket = new Set(basket.map((e) => e.unitId));
  const seen = new Set<string>();
  let cursor: string | null = unitId;
  while (cursor && !seen.has(cursor)) {
    if (inBasket.has(cursor)) return cursor;
    seen.add(cursor);
    cursor = tree.parentOf(cursor);
  }
  return null;
}

export function isCarried(basket: Basket, unitId: string, tree: BasketTree): boolean {
  return carrierOf(basket, unitId, tree) !== null;
}

/** Is `unitId` strictly below `ancestorId`? */
function isBelow(unitId: string, ancestorId: string, tree: BasketTree): boolean {
  const seen = new Set<string>();
  let cursor = tree.parentOf(unitId);
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true;
    seen.add(cursor);
    cursor = tree.parentOf(cursor);
  }
  return false;
}

export function addToBasket(basket: Basket, unitId: string, tree: BasketTree): AddResult {
  if (tree.parentOf(unitId) === null) return { outcome: "refused", basket };
  if (basket.some((e) => e.unitId === unitId)) return { outcome: "already", basket };
  const carrier = carrierOf(basket, unitId, tree);
  if (carrier) return { outcome: "inside", basket, carrierId: carrier };

  const below = basket.filter((e) => isBelow(e.unitId, unitId, tree));
  const kept = basket.filter((e) => !below.includes(e));
  const absorbed = below.flatMap((e) => [tree.nameOf(e.unitId), ...e.absorbed]);
  const entry: BasketEntry = { unitId, absorbed };
  return below.length > 0
    ? { outcome: "absorbed", basket: [...kept, entry], absorbed }
    : { outcome: "added", basket: [...kept, entry] };
}

/** Return an entry to where it lives: no geography or data changes. */
export function returnFromBasket(basket: Basket, unitId: string): Basket {
  return basket.filter((e) => e.unitId !== unitId);
}
