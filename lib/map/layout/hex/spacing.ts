/**
 * **One measure of distance** — the whole of it, in one file.
 *
 * Law 4 of [MAP-LAWS.md](../../../../docs/MAP-LAWS.md) says the engine may hold
 * no more than one rule for how far apart things sit. Until 2026-10-16 that was
 * true by convention: the rule lived inside `territory.ts` and everything else
 * was *handed* its figures. Convention was enough while the atlas was the only
 * thing that placed anything, and stopped being enough the moment a second
 * layout driver existed — two drivers importing one another is a cycle, and two
 * drivers each holding the rule is the fault the law was written against.
 *
 * So the rule has a home of its own and both drivers read it from here. The law
 * is now structural rather than conventional: there is nowhere else to put a
 * spacing number, and a reviewer can tell whether a file holds one by looking
 * at what it imports.
 *
 * Everything here moved out of `territory.ts` unchanged, doc comments and all.
 * They are the record of how each number was arrived at, and several of them
 * are the record of getting it wrong first.
 */

/** Clear cells between two sibling territories. Greg, 2026-10-03: *"sibling
 *  teams by default have one tile separating them."* Cousins and beyond get
 *  theirs from the nesting itself. */
export const SIBLING_GAP = 1;

/**
 * How many units a thing must hold before a clear tile round it buys anything.
 *
 * Greg, 2026-10-03: his rule was *"sibling **teams** have one tile separating
 * them"* — and it was being applied between every pair of sibling territories at
 * every rung, including two mid-level structural nodes nobody thinks of as
 * places. That one over-reading caused both of the faults he reported. It is
 * where the extra 51 of Northwind's 110 stranded units came from, and it is
 * what turned the gaps into **corridors** that the router then funnels many
 * chains down: mean chain length 2.8 → 4.1, longest 12 → 29.
 *
 * A clear tile is a *visual* device. It only does visual work when what it
 * surrounds is big enough to read as a region — two single cells with a gap
 * between them read as two cells with a gap, not as two places. So a territory
 * earns its clear ground by holding at least this many units, and anything
 * smaller sits tight against its family where it belongs.
 */
export const PLACE_SIZE = 4;

/**
 * **Room grows with the level of abstraction** (Greg, 2026-10-03).
 *
 * *"At the highest level of abstraction, the greatest number of hexagon tiles
 * are found between nodes. At the lowest level of abstraction, the team level,
 * each team should by default group together, resist exclaving, and exist with
 * a bubble of 1 tile around it… for every level of abstraction, add 1
 * additional tile-spacing rule between nodes."*
 *
 * So the gap is not one number any more. A unit's **tier** is how many rungs of
 * *places* sit under it — nought for a team, whose children are people rather
 * than regions; one for whatever holds teams; and up from there. The clear
 * ground a unit leaves between its children is its own tier, so teams are a
 * tile apart, the things that hold teams are two, and the master centre's
 * immediate reports get the widest streets on the map.
 *
 * This is what makes an atlas legible rather than merely nested: the eye reads
 * the size of a gap as the size of the thing it separates, long before it can
 * read a label.
 *
 * **Uncapped, deliberately** (Greg, 2026-10-03): *"remove the cap on how much
 * spacing can exist at the top levels — we can reinstate it later… the space
 * around master-centre in the next iteration should be HUUUGE. I want to see it
 * in extremis before moving to the next stage."*
 *
 * The point is not the spectacle. He is *"trying to fix the radiate/fan out
 * problem without forcing the thing into a fan — I want it to arrive there
 * naturally by merit of the structure and rules about how the structure is
 * displayed."* A centre too big to sit beside leaves its children nowhere to go
 * but around it, so the radial reading falls out of the spacing rule instead of
 * being imposed by a fan.
 *
 * **A cap, chosen for load time** (Greg, 2026-10-14).
 *
 * This is a design decision and should be read as one. The spacing *rule* is
 * `GAP_SHARE` — a gap is a third of the size of the thing it separates — and
 * left alone it settles at a halo of 119 tiles round the master centre of the
 * 2,562-person company. That is the "HUUUGE" centre Greg asked for on
 * 2026-10-03, and it is what the search then has to walk.
 *
 * Measured on Northwind with people as the smallest unit:
 *
 * | cap | layout | touching family | curl-back |
 * | --- | ---: | ---: | ---: |
 * | 3 | 0.8s | 86.5% | 33.6% |
 * | **12** | **1.4s** | **86.5%** | **32.1%** |
 * | 24 | 4.9s | 86.5% | 34.0% |
 * | 48 | 6.6s | 86.5% | 35.0% |
 *
 * **Cohesion is identical at every setting, and curl-back is slightly better
 * here than uncapped.** The halo buys width and nothing else measurable, and
 * past 24 it costs multiples of the load time — which is why Greg, asked to
 * choose, took the 4.7× speedup: *"the 'people' view now takes an insane time
 * to render."*
 *
 * It was `MAX_TIER_GAP = 3`, then uncapped as an experiment, then 48, and was
 * briefly called `RUNAWAY_GUARD` on the understanding that it never decided
 * anything. It did: at 48 it was already clipping the top of the two largest
 * companies. A number that shapes the map is a design decision whatever it is
 * called, so it is named for what it does.
 *
 * **This is the one line to change** to give the centre its full width back,
 * and the real fix for wanting both is lazy per-team interiors, parked on the
 * `hex-lazy-interiors` branch.
 */
export const MAX_HALO = 12;

/**
 * **The spacing curves rather than climbs** (Greg, 2026-10-04).
 *
 * *"Make the spacing rule 'curved' — make it follow a Fibonacci rather than a
 * linear progression. That should visually cluster teams and their parents and
 * push ever more space between the more distant relatives."*
 *
 * Which is exactly what the sequence does, and why it is the right curve rather
 * than merely a steep one. The first three terms barely separate at all — a
 * team and the thing that holds it stay as tight as they were — and then it
 * runs away: 1, 1, 2, 3, 5, 8, 13. Relatedness stops being something the eye
 * has to count rungs to recover and becomes something it reads off the width of
 * the gap, because the gaps are no longer evenly spaced enough to confuse.
 */
export const FIBONACCI = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

/**
 * **The gap scales with the thing it separates, not with how deep it sits.**
 *
 * The curve was right and the variable was wrong. Measured on the 2,562-person
 * company with the gap set by rung, the clear ground between groups ran from 5
 * tiles at the top to 1 at the bottom — while the groups themselves ran from a
 * radius of 119 to a radius of 1. So a division got air worth **4% of its own
 * width** and a pair of people got **100%**: the ratio was inverted, by a
 * factor of about twenty-five.
 *
 * That is why the map read as confetti rather than as an atlas. Every boundary
 * on screen was about the same width, so none of them said anything about what
 * it was separating, and the hierarchy was invisible at every zoom. Nothing was
 * scattered — it was the *uniformity* of the boundaries, which is a different
 * fault with the same appearance.
 *
 * A share of the territory's own size keeps the ratio constant instead, so a
 * division reads as a division at overview and a team reads as a team close up.
 * It is also self-limiting in a way the rung version was not: the map grows by
 * a constant factor per level rather than exponentially, which is what made the
 * uncapped rung-based curve take 233 seconds.
 *
 * The Fibonacci table stays for the floor — the first few tiles, where a share
 * of a tiny thing would round to nothing and a team still needs its one clear
 * tile.
 */
export const GAP_SHARE = 1 / 3;

/** Clear tiles owed to a territory of this radius. */
export const spacingFor = (radius: number): number =>
  radius <= 0 ? 0 : Math.max(1, Math.round(radius * GAP_SHARE));

/** The floor the old curve provided, kept for the smallest things. */
export const leastGapFor = (tier: number): number =>
  tier <= 0 ? 0 : FIBONACCI[Math.min(tier, FIBONACCI.length - 1)];


/**
 * **The spacer rule** (Greg, 2026-10-16), as one predicate both placers read.
 *
 * *"All nodes — human and structural — have a one hexagon space around them.
 * That is to say, each side of the hexagon representing that human or node
 * gains a connecting hexagon that forms its spacer. On load, or using the
 * auto-tidy function, the only things that can enter that node or human's
 * spacer hexagons are humans in the same team or humans that are direct
 * children of a structural node."*
 *
 * **It is stated as what may touch what, and that is why it is a better rule
 * than the four distances that came before it.** A distance has to be measured
 * between two things and both of them have an opinion about it, which is how
 * one gap came to be decided by whichever unit was owed the least. A touching
 * rule is a property of the pair: `mayTouch(a, b)` and `mayTouch(b, a)` are the
 * same question, so there is no side to read it from and nothing to reconcile.
 *
 * What falls out of it, none of which had to be asked for separately:
 *
 *  - **Two structural nodes are never adjacent.** Neither is a human, so neither
 *    may enter the other's spacer. Divisions, portfolios and teams get their
 *    clear hexagon without a number anywhere.
 *  - **Two humans touch only if they share a team**, so a team is one connected
 *    crowd with clear ground round it — *"teams should have one hexagon of clear
 *    space between them"*.
 *  - **A human touches a structural node only if it is theirs**: their own team,
 *    or the node they report to directly. The lead stands at the door, which is
 *    Law 3's own clause, and nobody else's people do.
 *
 * It lives here because it *is* the spacing rule now, and Law 4 says there is
 * one of those. Both the radial driver and `tidy` read it from this file.
 */
export function spacerRule(
  tree: { units: ReadonlyMap<string, { parentId: string | null }> },
  people: ReadonlySet<string>,
): { teamFor: (id: string) => string | null; mayTouch: (a: string, b: string) => boolean } {
  /** A human's team is their nearest structural ancestor. No new data: the
   *  `people` set says who is human and the tree says the rest. */
  const teams = new Map<string, string | null>();
  const teamFor = (id: string): string | null => {
    const had = teams.get(id);
    if (had !== undefined) return had;
    // Seeded before recursing, so a malformed cycle cannot hang the layout.
    teams.set(id, null);
    const parentId = tree.units.get(id)?.parentId ?? null;
    const answer = !parentId ? null : people.has(parentId) ? teamFor(parentId) : parentId;
    teams.set(id, answer);
    return answer;
  };

  const mayTouch = (a: string, b: string): boolean => {
    const aHuman = people.has(a);
    const bHuman = people.has(b);
    if (!aHuman && !bHuman) return false;
    if (aHuman && bHuman) {
      const ta = teamFor(a);
      return ta !== null && ta === teamFor(b);
    }
    const [node, human] = aHuman ? [b, a] : [a, b];
    return teamFor(human) === node || tree.units.get(human)?.parentId === node;
  };

  return { teamFor, mayTouch };
}
