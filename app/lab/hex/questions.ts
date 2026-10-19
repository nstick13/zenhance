/**
 * **What holding one node over another offers** (Greg, 2026-10-19).
 *
 * Two actions and no others, which is what the radial `/org` map has always
 * offered for this gesture: **reparent the branch**, or **merge the whole
 * thing**. Greg, having seen a third option here: *"We need the options to
 * match exactly what we had on the radial /org version… There should not be an
 * option that does whatever XOR thing is happening to the team not being
 * moved."*
 *
 * That third option — give them both a shared parent — moved the unit the hand
 * was **not** holding, and then left the map looking untouched, because a
 * reparent does not move anything. Two objections in one: it acted on
 * something nobody picked up, and it gave no sign it had acted.
 *
 * ## The invariant this file exists to hold
 *
 * **Reparent is always available.** Earlier the same day the dwell was gated to
 * pairs of the same kind — the grow study's *"like pairs with like"* — on the
 * same afternoon the adjacency route was deleted. Between them they left no
 * gesture at all for making a person report to a team, and Greg found it on his
 * second try: *"I was able to reparent Dune Team 5 into a child of Buff Team 6
 * (good), but thereafter unable to reparent or merge."* So the test that
 * matters is not that each pair gets the right offer; it is that **every pair
 * can be reparented**.
 */

export type HoldActions = {
  /** Always true: every pair of units has this route. */
  reparent: true;
  /** Whether folding the held unit into the other can mean anything. */
  merge: boolean;
  /** Why merging is off, for the dialog to say. Absent when it is on. */
  whyNotMerge?: string;
};

/**
 * `isPerson` is the lab's own `peopleIds.has`. Everything else is a place — a
 * team, a division, the company.
 *
 * **A person cannot be merged away.** Merging folds everything the held unit
 * holds into the other and then stops the held unit existing, which for a place
 * is a restructure and for a person would be deleting somebody. Reparenting is
 * what moving a person means, and it is still offered.
 */
export function holdActions(
  isPerson: (id: string) => boolean,
  heldId: string,
  overId: string,
): HoldActions {
  if (isPerson(heldId)) {
    return {
      reparent: true,
      merge: false,
      whyNotMerge: "A person cannot be merged into anything — there would be nobody left. Moving them is reparenting.",
    };
  }
  if (isPerson(overId)) {
    return {
      reparent: true,
      merge: false,
      whyNotMerge: "A place cannot be merged into a person. Reparenting is what putting one under the other means.",
    };
  }
  return { reparent: true, merge: true };
}
