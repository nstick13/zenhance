/**
 * **Holding one node over another, at any zoom** — the gesture Greg could not
 * make work on the 1,000-person company on 2026-10-30: *"I could only reparent
 * to Quartz Team 50 — while the animation fired, the dialog offering reparent
 * did not."*
 *
 * Two things were measured in the world and used against a hand that moves in
 * pixels, and both of them shrink to nothing as you zoom out:
 *
 * 1. **How still the hand must be.** The budget was a quarter of a cell, which
 *    is 27 px of allowance on Sparrow Jam at 0.30× and **0.9 px** on the
 *    1,000-person company at the 0.01× it opens on. It is now `HOLD_SLACK_PX`,
 *    read on the screen.
 * 2. **Who the hold is about.** The subject was re-decided from the cell under
 *    the pointer on every move, and at that zoom a cell is fifteen pixels
 *    across — so a few pixels of wobble kept stepping off the target onto empty
 *    ground, and `heldSubject` is what stops the subject flickering.
 *
 * Neither weakens the dwell: travel still restarts the clock, which is what
 * stops a branch carried across the map arming a merge on everything it passes
 * (Greg, 2026-10-01).
 */
import { describe, expect, it } from "vitest";
import { heldSubject, HOLD_SLACK_PX } from "@/app/lab/hex/HexLab";
import { hexSizeFor } from "@/lib/map/layout/hex/scene";

describe("who the hold is about", () => {
  it("takes the unit under the pointer", () => {
    expect(heldSubject(null, "union", true)).toBe("union");
  });

  it("keeps it when the hand slips onto the empty ground beside it", () => {
    // The measured failure: two moves before the release had Union Team 82,
    // and the release itself had nothing, because the wobble had crossed into
    // the next cell. One unit is fifteen pixels wide at that zoom.
    expect(heldSubject("union", null, true)).toBe("union");
  });

  it("hands over to another unit the moment the pointer is on one", () => {
    expect(heldSubject("union", "everest", true)).toBe("everest");
  });

  it("lets go once the hand has travelled", () => {
    // `stillHolding` false already restarts the clock; the subject goes with
    // it, so carrying a branch across the map arms nothing on the way.
    expect(heldSubject("union", null, false)).toBeNull();
  });

  it("still names the unit under a travelling hand, which the clock refuses", () => {
    // Being over somebody is not the same as holding: this says who, and the
    // clock — restarted by the same `stillHolding` — says whether.
    expect(heldSubject("union", "everest", false)).toBe("everest");
  });
});

describe("how still the hand must be", () => {
  it("is a distance on the screen, not a share of a cell", () => {
    // The regression guard. A quarter of a cell looks generous and is not:
    // it is the *world* that is being measured, so the allowance collapses
    // with the zoom. These are the numbers that made the gesture impossible.
    const asShareOfACell = (zoom: number) => hexSizeFor("roomy") * 0.25 * zoom;
    expect(asShareOfACell(0.3)).toBeCloseTo(27.3, 1); // Sparrow Jam, workable
    expect(asShareOfACell(0.01)).toBeLessThan(1); // the 1,000-person company
    // The budget in force does not move with the zoom at all.
    expect(HOLD_SLACK_PX).toBeGreaterThan(asShareOfACell(0.01) * 20);
    expect(HOLD_SLACK_PX).toBe(24);
  });
});
