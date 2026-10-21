/**
 * **Whose ground is a cell standing on?**
 *
 * Greg, 2026-10-19/20, on the canvas interactions he wants: *"We're going to
 * need some canvas interactions, rather like Miro — pan, zoom, double-click,
 * right click options. I think the next model needs a double-click thing, and
 * depending on what you click, you get options."* *Depending on what you
 * click* is this file.
 *
 * The map already draws the answer. Every unit keeps a clear hexagon around
 * itself, and every group of teams keeps a second one outside that — both in
 * grey, both meaning *this is somebody's own space* (`spacing.ts` decides the
 * gaps, `bubbles.ts` draws them). So a double-click on grey ground does not
 * have to ask what the new thing belongs to. The ground says.
 *
 * **The zones nest, and the innermost one wins.** A person's own hexagon sits
 * inside their team's ground, which sits inside the ring their group keeps.
 * Standing in all three, you are standing in the person's.
 *
 * ## This gives a region a meaning it deliberately did not have
 *
 * Greg, 2026-10-19: *"you'll note regions around teams — these aren't
 * meaningful YET — only the nodes themselves (rather than the spacing around
 * them) create interactions such as merge or reparent."*
 *
 * That still holds, because it is about a **drop**. A tile comes to rest
 * beside something for all sorts of reasons — it was carried past, the ground
 * it wanted was taken, the hand let go — so reading intent out of where it
 * landed is reading something that was never said. A double-click says it: it
 * is somebody pointing at a spot and asking for something there. The two
 * readings can hold at once, and nothing in the drag path reads this file.
 */
import { cellKey, ring, type Cell } from "./coords";

/** Somebody's own space, and which of the two hexagons of it you are in. */
export type Ground = {
  /** The unit nearest you — a person or a place. */
  unitId: string;
  /** 1 — that unit's own clear hexagon. 2 — the ring its group keeps. */
  ring: 1 | 2;
};

/**
 * The ground a vacant cell belongs to, or `null` for open paper.
 *
 * An occupied cell answers `null` too: somebody is standing there, so the
 * question is about **them** rather than about their space — that is the node
 * menu, not the create menu.
 *
 * Within one ring the **deepest** unit wins, which is "innermost wins" one
 * layer down: where a person and their own team are both a step away, the
 * person is the more specific answer.
 */
export function groundAt(options: {
  cell: Cell;
  /** `cellKey` → unit id, exactly as the layout publishes it. */
  occupants: ReadonlyMap<string, string>;
  depthOf: (unitId: string) => number;
}): Ground | null {
  const { cell, occupants, depthOf } = options;
  if (occupants.has(cellKey(cell))) return null;

  for (const radius of [1, 2] as const) {
    let best: Ground | null = null;
    let bestDepth = -1;
    for (const near of ring(cell, radius)) {
      const id = occupants.get(cellKey(near));
      if (id === undefined) continue;
      const depth = depthOf(id);
      // Depth first, then the id, so a cell sitting between two equals always
      // answers the same way however the map was built.
      if (depth > bestDepth || (depth === bestDepth && best !== null && id < best.unitId)) {
        best = { unitId: id, ring: radius };
        bestDepth = depth;
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * **What a thing made on this ground would belong to**, or `null` for an
 * island — something standing on its own.
 *
 * Two readings, and they are the two the map draws:
 *
 *  - **The first hexagon is the unit's own space**, so making something there
 *    makes it theirs. A *person's* space resolves to the team they are in,
 *    because a person is not a place for anything to live inside — Greg's own
 *    words for this gesture were *"creates inside that team by default"*. The
 *    way to put somebody **under** a person is to double-click the person.
 *  - **The second hexagon is the group's**, and a group is the teams with a
 *    common parent, so it resolves one step further up.
 */
export function holderOf(options: {
  ground: Ground;
  parentOf: (unitId: string) => string | null;
  isPerson: (unitId: string) => boolean;
}): string | null {
  const { ground, parentOf, isPerson } = options;

  /** Up to the nearest place, which may be the unit handed in. */
  const place = (from: string | null): string | null => {
    let at = from;
    // Every walk here is strictly upward and the tree is finite, but a stale
    // override could in principle hand us a cycle, and this runs on a pointer
    // event. Count rather than trust.
    for (let guard = 0; at && guard < 64; guard++) {
      if (!isPerson(at)) return at;
      at = parentOf(at);
    }
    return at;
  };

  const own = place(ground.unitId);
  if (ground.ring === 1) return own;
  return own ? place(parentOf(own)) : null;
}
