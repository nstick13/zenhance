/**
 * **The hand's layer** — the cells a person decided, and what the engine is
 * allowed to do about them.
 *
 * Two rules live here, and they are the same rule read from both ends:
 * `applyHand` puts the hand's placements on top of whatever the engine laid,
 * and `settle` decides when everything else becomes the hand's as well. Both
 * were written inside `HexLab.tsx`; they are here so the lattice's most
 * consequential promise — *where you put something is where it stays* — can be
 * driven by a test rather than by clicking.
 */
import { cellKey, type Cell } from "@/lib/map/layout/hex/coords";

/**
 * **A hand placement only lands if its cell is still free.**
 *
 * Hand placements live in one browser and the engine changes underneath them —
 * a new rule, a different shape, a fix to the packer — and the cell somebody
 * put a tile on last week now belongs to somebody else. Applying them blindly
 * put two units on one cell: Greg, 2026-10-03, replaying 1,258 saved
 * placements, *"72 units sharing a cell with another — they cannot be pointed
 * at."* Measured on a saved arrangement from the other shape, 1,479 placements
 * produced 66 of them.
 *
 * Checking as we go keeps the map **injective at every step**, which is the
 * property that matters: the layout starts with one unit per cell, a placement
 * is only taken when its target is free, and taking it frees the cell that
 * unit came from. So the invariant cannot be broken by any sequence of
 * placements, however stale. Anything refused simply stays where the engine
 * put it, which is the honest answer to "that cell is not yours any more".
 */
export function applyHand(
  laid: ReadonlyMap<string, Cell>,
  moves: ReadonlyMap<string, Cell>,
): { cells: Map<string, Cell>; occupants: Map<string, string> } {
  const cells = new Map(laid);
  const occupants = new Map<string, string>();
  for (const [id, cell] of cells) occupants.set(cellKey(cell), id);
  for (const [id, cell] of moves) {
    // A unit that has been merged away still has its old placement saved, and
    // stamping that on would put a ghost back on the map with nothing behind
    // it. The layout is the authority on who exists.
    if (!cells.has(id)) continue;
    const key = cellKey(cell);
    const holder = occupants.get(key);
    if (holder !== undefined && holder !== id) continue;
    const had = cells.get(id);
    if (had) occupants.delete(cellKey(had));
    cells.set(id, cell);
    occupants.set(key, id);
  }
  return { cells, occupants };
}

/**
 * **The map stays where it is when you make something.**
 *
 * Making one node on Sparrow Jam used to move the whole company. The map went
 * from 2,814 × 2,837 world units to 4,452 × 4,098, and four of its five units
 * left the cell they were standing on — up to five cells away. The thing you
 * made stayed exactly where you put it, because everything born here is born
 * as a hand placement under Law 0; it was *everything else* that answered to
 * the engine again, and the result read as though the map had flinched.
 *
 * ## Why one node moved everything
 *
 * The layout is a pure function of the whole tree, so one more unit re-derives
 * every other one. On a five-unit company a sixth unit is a fifth of the
 * company, and the ring schedule in `radial.ts` is a single schedule for the
 * whole map: `floors[d] = floors[d-1] + 1 + max(keep)`. Adding one child to
 * Granite Division took that schedule from `[0,2]` to `[0,3,5]` — a rung that
 * had not been a *place* before became one — and every rung outside it
 * re-seated. Nothing was broken: the engine was asked the question again and
 * gave a good answer to a slightly different company.
 *
 * It is a small-company effect by arithmetic. The same gesture on Northwind
 * moves the map by half a percent, which nobody can see. There is a case that
 * a visible re-lay is *honest* at five units, and a stronger case that a map
 * which jumps when you add one person is a map people stop trusting — which is
 * the call Greg made on 2026-10-30: **fix it**.
 *
 * ## What happens instead
 *
 * Where everything stands becomes the hand's answer at the moment you make
 * something. Nothing re-lays, because nothing is left for the engine to
 * decide — and **tidy is the way back**, as it always has been: its first
 * press asks the engine to lay the company again with the new node in it, and
 * its second throws the whole arrangement away.
 *
 * This invents no mechanism. `moves` already means *a cell a hand decided*, it
 * already survives a reload, and tidy already re-lays over the top of it. The
 * only new idea is **when** it is written.
 *
 * Deliberately **not** `pinned`, which is the narrower claim — *the hand put
 * this here and no driver may move it* — and belongs to the nodes somebody
 * actually made. A unit that is merely standing still should still be tidied.
 *
 * `cells` is the allocation **after** `applyHand`, which is what is on the
 * screen, so this keeps what you can see rather than what the engine last
 * thought. The one case where those differ is a stale placement that was
 * refused because its cell now belongs to somebody else; keeping the visible
 * cell drops it, which is the honest reading of *"that cell is not yours any
 * more"* and leaves the result injective — one unit per cell in, one unit per
 * cell out.
 *
 * `except` is for the root a tree builder synthesises when a company has
 * several things at the top, or none. It stands on a cell like anything else
 * and nobody can point at it, so a placement for it is a placement no hand
 * ever made — and one that outlives the shape that needed it, since the same
 * company with one top-level unit has no synthesised root at all.
 */
export function settle(
  cells: ReadonlyMap<string, Cell>,
  moves: ReadonlyMap<string, Cell>,
  except?: string | null,
): Map<string, Cell> {
  const next = new Map(moves);
  for (const [id, cell] of cells) if (id !== except) next.set(id, cell);
  return next;
}
