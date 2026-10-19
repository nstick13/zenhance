/**
 * **Every pair can be reparented.**
 *
 * The regression this exists to prevent: on 2026-10-19 the dwell was gated to
 * pairs of the same kind on the same day the adjacency route was deleted, and
 * between them they left no way at all to make a person report to a team.
 * Greg hit it on the second gesture he tried.
 */
import { describe, expect, it } from "vitest";
import { holdActions } from "@/app/lab/hex/questions";

const people = new Set(["ana", "bo"]);
const isPerson = (id: string) => people.has(id);
const everyone = ["ana", "bo", "team", "division"];

describe("what holding one node over another offers", () => {
  /** The one that matters. */
  it("offers a reparent for every pair, whichever two are held together", () => {
    for (const a of everyone) {
      for (const b of everyone) {
        if (a === b) continue;
        expect(holdActions(isPerson, a, b).reparent).toBe(true);
      }
    }
  });

  it("offers a merge between two places", () => {
    expect(holdActions(isPerson, "team", "division").merge).toBe(true);
    expect(holdActions(isPerson, "team", "division").whyNotMerge).toBeUndefined();
  });

  it("will not merge a person away, and says why", () => {
    const held = holdActions(isPerson, "ana", "team");
    expect(held.merge).toBe(false);
    expect(held.whyNotMerge).toMatch(/person/i);
  });

  it("will not merge a place into a person either", () => {
    expect(holdActions(isPerson, "team", "ana").merge).toBe(false);
  });

  it("will not merge two people into one person", () => {
    expect(holdActions(isPerson, "ana", "bo").merge).toBe(false);
  });

  it("always explains a merge it is refusing", () => {
    for (const a of everyone) {
      for (const b of everyone) {
        if (a === b) continue;
        const actions = holdActions(isPerson, a, b);
        if (!actions.merge) expect(actions.whyNotMerge).toBeTruthy();
      }
    }
  });
});
