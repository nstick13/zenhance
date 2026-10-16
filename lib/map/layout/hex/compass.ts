/**
 * **The compass — where "outward" comes from.**
 *
 * A bearing for every unit, worked out from the shape of the company before a
 * single cell is packed. It is the mechanism that finally served Law 3 of
 * [MAP-LAWS.md](../../../../docs/MAP-LAWS.md) after three relative rules failed
 * at it, and the write-up of why is in
 * [HEX-LAYOUT.md](../../../../docs/HEX-LAYOUT.md) § The compass.
 *
 * It moved out of `territory.ts` on 2026-10-16, unchanged, because the radial
 * driver needs it too and two drivers importing one another is a cycle. That it
 * is wanted by both is the point rather than an inconvenience: a bearing is not
 * the atlas's private business, it is the company's.
 */
import { DIRECTIONS } from "@/lib/map/layout/hex/coords";
import type { OrbitalTree } from "@/lib/map/layout/model";

/**
 * **Which way is out — decided for the whole company before anything is packed.**
 *
 * Greg, 2026-10-14: *"we're getting quite a lot of loopback on connection
 * lines still."* The lines were not the fault: 95% of them are dead straight.
 * What loops is the **way home** — walk a person up through every manager to
 * the master centre and the path doubles back at least once for 94% of them,
 * running 1.8× the direct distance at the median.
 *
 * The cause is that the packer had no idea where the centre was. `placeChild`
 * runs inside `measure`, which is bottom-up: when a unit's children are placed,
 * nobody yet knows where that unit will stand in the world, so "outward" could
 * only ever be guessed from the last step taken — the direction the unit sits
 * from *its* parent. That guess is local, and a local guess is not a radius.
 * Measured on the 1,000-person company: of the 408 units sitting nearer the
 * centre than their own parent, **only 151 were also behind their parent**. The
 * other 257 were placed forward of their parent and still ended up nearer the
 * middle, where no local rule can see them. It is why penalising the home side
 * moved the number by one point and why reading the facing back off the
 * placement — the right fix for the spiral — did not touch it either.
 *
 * So decide it combinatorially instead, and decide it first. The root owns the
 * whole circle; every unit hands its children an arc centred on its own
 * heading; a unit's heading is the one of the six lattice directions nearest
 * the middle of its arc. It is O(units), it needs no geometry, and because an
 * arc is an **absolute** bearing rather than a turn relative to a parent, it
 * cannot accumulate — which is the failure mode Greg named on 2026-10-06:
 * *"we end up with spirals within four steps."*
 *
 * This replaces `settleFacing`'s second placement rather than adding to it, so
 * the layout does less work than before, not more.
 */
/**
 * **A unit's children fan over half a turn, and never less than a sixth.**
 *
 * The cap is what keeps a grandchild from being aimed back the way it came:
 * half a turn centred on a unit's own bearing reaches ±90°, so nothing is ever
 * pointed behind its parent.
 *
 * The floor is one lattice direction — the narrowest fan that can still give
 * two children different bearings. It is there because proportional sharing
 * collapses: a ten-person team inside a 2,500-person company owns about a
 * degree and a half of the circle, so without a floor every descendant asks for
 * the same single direction and the branch packs into a thread.
 *
 * **Both numbers are chosen rather than measured, and that is deliberate.**
 * Swept across the three companies, every setting in the range improves on
 * having no compass at all — but neighbouring values jump around (one floor
 * giving 9.7% curl-back and the next 15.8%), because snapping a continuous
 * bearing to six directions flips many units at once. A number tuned to the
 * best reading on one fixture would be fitting noise. These two can be
 * explained in a sentence each, which is the better property.
 */
/**
 * Exported since 2026-10-16, because the radial driver fans children over an arc
 * too and must fan them over *this* arc. A second copy of the cap and the floor
 * is the same mistake as a second spacing rule: the radial driver's first cut
 * shared arc by subtree weight with no floor at all, and collapsed exactly as
 * this file's own doc says proportional sharing collapses — slivers of arc, bands
 * walking outward to find a cell inside one, and chains fifteen cells long.
 */
export const ARC = Math.PI;
export const FLOOR = Math.PI / 3;

/** The world angle each lattice direction points along. Derived rather than
 *  assumed: `cellToWorld` puts a cell at `(1.5q, √3(r + q/2))`, so what
 *  `DIRECTIONS` calls "east" actually points at 30°. */
const DIRECTION_ANGLE: readonly number[] = DIRECTIONS.map((d) =>
  Math.atan2(Math.sqrt(3) * (d.r + d.q / 2), 1.5 * d.q));

/** The lattice direction nearest a bearing. Exported since 2026-10-16: the
 *  radial driver needs it for the same job, and deriving it a second time is
 *  how you get the 30° error described there. */
export const headingAt = (angle: number): number => {
  let best = 0;
  let bestOff = Infinity;
  for (let i = 0; i < 6; i++) {
    let off = Math.abs(angle - DIRECTION_ANGLE[i]) % (2 * Math.PI);
    if (off > Math.PI) off = 2 * Math.PI - off;
    if (off < bestOff) { bestOff = off; best = i; }
  }
  return best;
};

/**
 * A bearing for every unit, as one of the six lattice directions.
 *
 * Children share their parent's arc in proportion to how much of the company
 * hangs beneath them, so a big division gets a wide sweep and a two-person team
 * gets a sliver. The arc is capped rather than merely inherited: left to narrow
 * on its own it collapses within four rungs and every descendant of a deep unit
 * asks for the same single direction, which packs a branch into a thread. One
 * half-turn, centred on the parent's own bearing, keeps a fan at every rung
 * while putting nothing behind its parent.
 */
export function headings(
  tree: OrbitalTree,
  /**
   * Which way the root of this tree faces, and how wide a sweep its children
   * get. The default is *nowhere in particular, and the whole circle*, which is
   * right for a company: it has no parent to grow away from.
   *
   * A **branch** does. When one is re-laid where a hand put it, its own parent
   * is somewhere outside it, and a branch that fans all the way round puts half
   * of itself behind the node it reports to. So the re-lay hands in the bearing
   * away from home and the same half-turn every other rung gets.
   */
  options: { bearing?: number; arc?: number } = {},
): Map<string, number> {
  const out = new Map<string, number>();
  const root = tree.units.get(tree.rootId);
  if (!root) return out;

  const weight = new Map<string, number>();
  const weigh = (id: string): number => {
    const had = weight.get(id);
    if (had !== undefined) return had;
    let n = 1;
    for (const kid of tree.units.get(id)?.childIds ?? []) n += weigh(kid);
    weight.set(id, n);
    return n;
  };
  weigh(root.id);

  const bearing = options.bearing ?? 0;
  const sweep = options.arc ?? 2 * Math.PI;
  out.set(root.id, headingAt(bearing));
  const walk = (id: string, centre: number, width: number) => {
    const kids = tree.units.get(id)?.childIds ?? [];
    if (!kids.length) return;
    let total = 0;
    for (const kid of kids) total += weigh(kid);
    let at = centre - width / 2;
    for (const kid of kids) {
      const span = width * (weigh(kid) / Math.max(1, total));
      const mid = at + span / 2;
      out.set(kid, headingAt(mid));
      // **Floored as well as capped.** Proportional alone collapses: a ten-person
      // team inside a 2,500-person company owns about a degree and a half, so
      // every one of its descendants asks for the same single direction and the
      // branch packs into a thread. The floor keeps a fan at every rung; the cap
      // keeps a grandchild from being aimed back the way it came.
      walk(kid, mid, Math.min(Math.max(span, FLOOR), ARC));
      at += span;
    }
  };
  walk(root.id, bearing, sweep);
  return out;
}
