/**
 * The tray — the basket's edge of the screen, and what a press on it means
 * (part of the basket engine; see docs/ENGINES.md).
 *
 * `basket.ts` next door owns *what may be carried*. This file owns the bit
 * the hand touches: whether a pointer counts as over the tray, whether a
 * press was a tap or a drag, and what the map says back when a carry lands.
 *
 * All of it used to be inline in the component, where the wording of five
 * different outcomes had no test and the tap/drag threshold was a bare `6`
 * in the middle of a pointer handler.
 */
import type { AddResult, Basket, BasketTree } from "./basket";

export type Point = { x: number; y: number };
export type Rect = { left: number; right: number; top: number; bottom: number };

/** How far outside the tray still counts. A thumb on a touchscreen lands
 *  wide of where its owner thinks it does, and the tray sits at the edge
 *  where there is nothing else to hit by mistake. */
export const TRAY_SLACK = 12;

/** How far a press must travel before it is a drag and not a tap. Below this
 *  a wobbling finger would drag a branch out of the basket by accident. */
export const DRAG_THRESHOLD = 6;

/** How long an entry stays lit after something points at it. */
export const FLASH_MS = 1600;

export function overTray(point: Point | null, rect: Rect | null, slack = TRAY_SLACK): boolean {
  if (!point || !rect) return false;
  return (
    point.x >= rect.left - slack && point.x <= rect.right + slack &&
    point.y >= rect.top - slack && point.y <= rect.bottom + slack
  );
}

/** Has this press become a drag yet? */
export const isDragging = (start: Point, now: Point, threshold = DRAG_THRESHOLD): boolean =>
  Math.hypot(now.x - start.x, now.y - start.y) >= threshold;

/** Every unit travelling in the basket: the entries and everything below
 *  them. A unit always travels with its whole branch. */
export function carriedBranch(
  basket: Basket,
  childrenOf: (unitId: string) => readonly string[],
): Set<string> {
  const out = new Set<string>();
  const stack = basket.map((e) => e.unitId);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...childrenOf(id));
  }
  return out;
}

export const carriedRoots = (basket: Basket): Set<string> =>
  new Set(basket.map((e) => e.unitId));

export type CarryTold = {
  /** What the map says. Plain English, because the rules are surprising the
   *  first time they bite. */
  notice: string;
  /** An entry to light up, so "already in the basket" points at *where*. */
  flash: string | null;
};

/**
 * What to say when a carry is attempted.
 *
 * Every outcome gets a sentence. The two that mean "nothing happened"
 * — `already` and `inside` — also light the entry that explains why, because
 * a notice alone leaves the viewer hunting a tray of near-identical chips.
 */
export function carryTold(result: AddResult, unitId: string, tree: BasketTree): CarryTold {
  const name = tree.nameOf(unitId);
  switch (result.outcome) {
    case "added":
      return {
        notice: `Carrying ${name}. Pan anywhere, then drag it out of the basket to place it.`,
        flash: null,
      };
    case "absorbed": {
      const list = result.absorbed.join(", ");
      const verb = result.absorbed.length === 1 ? "is" : "are";
      return { notice: `${list} ${verb} now carried inside ${name}'s branch.`, flash: null };
    }
    case "already":
      return { notice: `${name} is already in the basket.`, flash: unitId };
    case "inside":
      return {
        notice: `${name} is already carried with ${tree.nameOf(result.carrierId)}'s branch.`,
        flash: result.carrierId,
      };
    case "refused":
      return {
        notice: "The company stays where it is — it is the centre of its own map.",
        flash: null,
      };
  }
}

/** What the map says when a branch is dragged out and there is nowhere for
 *  it to go. It stays in the basket — not back at its origin, which it never
 *  actually left. */
export const noRoomNotice = (name: string): string =>
  `No room for ${name} there — it's still in the basket.`;
