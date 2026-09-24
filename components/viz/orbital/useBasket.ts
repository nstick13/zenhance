"use client";

/**
 * The basket engine's React half (docs/ENGINES.md § Basket).
 *
 * The basket is how you move a branch across a map too big to drag across:
 * drop it at the edge, pan wherever you like, drag it back out. Nothing is
 * saved while it is in there — not a position, not a relationship.
 *
 * This hook owns the tray: what is in it, whether the pointer is over it,
 * whether a press was a tap or a drag, and which entry is lit. The rules
 * about *what may be carried* are in `lib/map/basket/basket.ts` and the tray
 * arithmetic is in `tray.ts`, both pure and tested.
 *
 * ## The seam with Growth
 *
 * Dragging an entry out of the tray ends in an ordinary drop on the map, and
 * a drop is the **growth** engine's business — insertion plans, merge and
 * reparent proposals. Basket and Growth are siblings, so neither may import
 * the other (see ENGINES.md § The rule).
 *
 * So this hook does not know what a drop means. It reports *intent* — "this
 * press became a drag of unit X", "the pointer left the tray", "the drag
 * ended, cancelled or not" — through the callbacks below, and the map wires
 * those to the drag machinery. When Growth is extracted, those callbacks are
 * the join, and both sides will meet in `runtime` rather than in the
 * component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addToBasket,
  returnFromBasket,
  type Basket,
  type BasketTree,
} from "@/lib/map/basket/basket";
import {
  FLASH_MS,
  carriedBranch as branchOf,
  carriedRoots as rootsOf,
  carryTold,
  isDragging,
  noRoomNotice,
  overTray as pointerOverTray,
  type Point,
} from "@/lib/map/basket/tray";

type Options = {
  tree: BasketTree;
  /** A unit's children, for working out what travels with an entry. */
  childrenOf: (unitId: string) => readonly string[];
  /** Tell the viewer what happened. */
  say: (notice: string) => void;

  // --- the seam with Growth (see the note above) --------------------------
  /** A press on an entry became a drag. Start a drag of this unit that knows
   *  it came from the basket. Return false if it cannot start. */
  beginCarryDrag: (unitId: string) => boolean;
  /** The pointer moved while carrying. */
  onCarryMove: (client: Point) => void;
  /** The drag finished. Return true if the branch actually landed on the map
   *  — in which case it leaves the basket. False means it is still carried. */
  endCarryDrag: (cancelled: boolean) => { landed: boolean; unitId: string } | null;
  /** A tap, not a drag: go and look at where the branch lives. */
  locate: (unitId: string) => void;
};

export type BasketApi = {
  basket: Basket;
  /** Read the basket during a drag, where state would be stale. */
  basketRef: React.RefObject<Basket>;
  /** Every unit travelling: entries and everything beneath them. */
  carriedBranch: Set<string>;
  /** Just the entries. */
  carriedRoots: Set<string>;
  trayRef: React.RefObject<HTMLElement | null>;
  /** The pointer is over the tray right now — the tray lights up. */
  trayHot: boolean;
  setTrayHot: (hot: boolean) => void;
  /** The entry currently lit, because something pointed at it. */
  flashEntry: string | null;
  flash: (unitId: string) => void;
  /** Is this screen point over the tray? Generous by a few pixels. */
  isOverTray: (client: Point | null) => boolean;

  /** Put a unit's branch in the basket, and say plainly what happened. */
  carry: (unitId: string) => void;
  /** Take an entry out without placing it — it goes back to where it lives. */
  returnEntry: (unitId: string) => void;
  /** Empty the basket. Nothing moves: every branch is already where it lives. */
  returnAll: () => void;
  /** Called by the map when a carried branch lands somewhere. */
  settle: (unitId: string) => void;
  /** The message for a branch that found nowhere to go. */
  noRoom: (unitId: string) => string;

  /** Pointer handlers for a tray entry. */
  pressEntry: (event: React.PointerEvent<HTMLElement>) => void;
  moveEntry: (event: React.PointerEvent<HTMLElement>) => void;
  releaseEntry: (event: React.PointerEvent<HTMLElement>) => void;
  cancelEntry: (event: React.PointerEvent<HTMLElement>) => void;
};

export function useBasket({
  tree, childrenOf, say, beginCarryDrag, onCarryMove, endCarryDrag, locate,
}: Options): BasketApi {
  const [basket, setBasket] = useState<Basket>([]);
  const [trayHot, setTrayHot] = useState(false);
  const [flashEntry, setFlashEntry] = useState<string | null>(null);

  const basketRef = useRef<Basket>([]);
  const trayRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<{ unitId: string; start: Point; pointerId: number; dragging: boolean } | null>(null);

  useEffect(() => { basketRef.current = basket; }, [basket]);

  const carriedBranch = useMemo(() => branchOf(basket, childrenOf), [basket, childrenOf]);
  const carriedRoots = useMemo(() => rootsOf(basket), [basket]);

  const flash = useCallback((unitId: string) => setFlashEntry(unitId), []);

  useEffect(() => {
    if (!flashEntry) return;
    const timer = window.setTimeout(() => setFlashEntry(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashEntry]);

  const isOverTray = useCallback((client: Point | null) => {
    const tray = trayRef.current;
    return pointerOverTray(client, tray ? tray.getBoundingClientRect() : null);
  }, []);

  const carry = useCallback((unitId: string) => {
    const result = addToBasket(basketRef.current, unitId, tree);
    basketRef.current = result.basket;
    setBasket(result.basket);
    const { notice, flash: lit } = carryTold(result, unitId, tree);
    say(notice);
    if (lit) setFlashEntry(lit);
  }, [tree, say]);

  const returnEntry = useCallback((unitId: string) => {
    setBasket((current) => returnFromBasket(current, unitId));
  }, []);

  const returnAll = useCallback(() => setBasket([]), []);

  const settle = useCallback((unitId: string) => {
    setBasket((current) => returnFromBasket(current, unitId));
  }, []);

  const noRoom = useCallback((unitId: string) => noRoomNotice(tree.nameOf(unitId)), [tree]);

  // --- pressing an entry: a tap finds the branch, a drag carries it out ----

  const pressEntry = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const unitId = event.currentTarget.dataset.unitId;
    if (!unitId || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = {
      unitId,
      start: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      dragging: false,
    };
  }, []);

  const moveEntry = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const client = { x: event.clientX, y: event.clientY };
    if (!press.dragging) {
      if (!isDragging(press.start, client)) return;
      if (!beginCarryDrag(press.unitId)) return;
      press.dragging = true;
    }
    onCarryMove(client);
  }, [beginCarryDrag, onCarryMove]);

  const endEntry = useCallback((event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.pointerId !== event.pointerId) return;
    if (!press.dragging) {
      // A tap. Nothing moves; go and look at where it lives.
      if (!cancelled) locate(press.unitId);
      return;
    }
    setTrayHot(false);
    const result = endCarryDrag(cancelled);
    if (result?.landed) settle(result.unitId);
  }, [endCarryDrag, locate, settle]);

  const releaseEntry = useCallback(
    (event: React.PointerEvent<HTMLElement>) => endEntry(event, false), [endEntry]);
  const cancelEntry = useCallback(
    (event: React.PointerEvent<HTMLElement>) => endEntry(event, true), [endEntry]);

  return {
    basket, basketRef, carriedBranch, carriedRoots,
    trayRef, trayHot, setTrayHot, flashEntry, flash, isOverTray,
    carry, returnEntry, returnAll, settle, noRoom,
    pressEntry, moveEntry, releaseEntry, cancelEntry,
  };
}
