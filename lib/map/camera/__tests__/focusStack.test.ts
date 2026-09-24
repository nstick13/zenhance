import { describe, expect, it } from "vitest";
import {
  activeFocus,
  clearFocus,
  focusToCrumb,
  hasParentFocus,
  parentFocus,
  popFocus,
  pushFocus,
  type FocusFrame,
} from "../focusStack";

const stack = (...ids: string[]): FocusFrame[] => ids.map((unitId) => ({ unitId }));
const ids = (frames: readonly FocusFrame[]) => frames.map((f) => f.unitId);

describe("where we are", () => {
  it("is nowhere at the company", () => {
    expect(activeFocus([])).toBeNull();
    expect(parentFocus([])).toBeNull();
    expect(hasParentFocus([])).toBe(false);
  });

  it("is the deepest frame", () => {
    expect(activeFocus(stack("a", "b", "c"))).toBe("c");
    expect(parentFocus(stack("a", "b", "c"))).toBe("b");
    expect(hasParentFocus(stack("a", "b"))).toBe(true);
  });

  it("has no parent one level in", () => {
    expect(parentFocus(stack("a"))).toBeNull();
    expect(hasParentFocus(stack("a"))).toBe(false);
  });
});

describe("going deeper and back", () => {
  it("nests", () => {
    expect(ids(pushFocus(stack("a"), "b"))).toEqual(["a", "b"]);
  });

  it("ignores focusing the unit you are already in", () => {
    // Otherwise Escape needs pressing twice to leave one place.
    expect(ids(pushFocus(stack("a", "b"), "b"))).toEqual(["a", "b"]);
  });

  it("allows re-entering an ancestor deeper down, which is a real path", () => {
    expect(ids(pushFocus(stack("a", "b"), "a"))).toEqual(["a", "b", "a"]);
  });

  it("steps back out one at a time", () => {
    expect(ids(popFocus(stack("a", "b", "c")))).toEqual(["a", "b"]);
    expect(ids(popFocus(stack("a")))).toEqual([]);
  });

  it("pops an empty stack without complaint", () => {
    expect(ids(popFocus([]))).toEqual([]);
  });

  it("never mutates what it was given", () => {
    const before = stack("a", "b");
    pushFocus(before, "c");
    popFocus(before);
    focusToCrumb(before, "a");
    expect(ids(before)).toEqual(["a", "b"]);
  });

  it("clears to the company", () => {
    expect(clearFocus()).toEqual([]);
  });
});

describe("clicking a breadcrumb", () => {
  it("steps back out to a crumb already in the path, dropping everything deeper", () => {
    expect(ids(focusToCrumb(stack("delivery", "platform", "payments"), "delivery")))
      .toEqual(["delivery"]);
  });

  it("is a no-op on the crumb you are standing on", () => {
    expect(ids(focusToCrumb(stack("a", "b"), "b"))).toEqual(["a", "b"]);
  });

  it("moves sideways to a sibling by replacing the deepest frame, not nesting", () => {
    // Payments and Billing are siblings under Platform. Clicking Billing from
    // inside Payments should leave you *in* Billing at the same depth — not
    // inside Payments ▸ Billing, which is not a real place.
    expect(ids(focusToCrumb(stack("delivery", "platform", "payments"), "billing")))
      .toEqual(["delivery", "platform", "billing"]);
  });

  it("stays at the company when there is nothing to replace", () => {
    expect(ids(focusToCrumb([], "anything"))).toEqual([]);
  });

  it("truncates to the first occurrence when a unit appears twice", () => {
    expect(ids(focusToCrumb(stack("a", "b", "a", "c"), "a"))).toEqual(["a"]);
  });
});
