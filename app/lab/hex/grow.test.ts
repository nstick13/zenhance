/**
 * **Growing a company from nothing** — the rules of the sequence, 2026-10-19.
 *
 * Greg, bringing the grow study into hex: *"lab/grow was brilliant — you
 * created an intelligible, clear way of us building teams. We need to do that
 * within the hex layout paradigm."*
 *
 * The two rules worth a test are the ones that were easiest to get wrong in
 * the original study: **what counts as finished**, and **who gets asked the
 * question the whole thing exists for**.
 */
import { describe, expect, it } from "vitest";
import { stepsFor, stillNeeds, type Born } from "@/app/lab/hex/HexLab";

const person = (over: Partial<Born> = {}): Born => ({
  id: "p1", kind: "person", name: null, role: null, purpose: null, parentId: null, ...over,
});
const place = (over: Partial<Born> = {}): Born => ({
  id: "t1", kind: "place", name: null, role: null, purpose: null, parentId: null, ...over,
});

describe("a node breathes until it is described, not until it is named", () => {
  it("asks for a name first", () => {
    expect(stillNeeds(person())).toBe("Needs a name");
    expect(stillNeeds(place())).toBe("Needs a name");
  });

  it("is still unfinished once it has only a name", () => {
    // The rule the original study had to learn: "named but no role" is still
    // an empty node, and the sub-label always says what is missing.
    expect(stillNeeds(person({ name: "Ana Whitfield" }))).toBe("Needs a role");
    expect(stillNeeds(place({ name: "Checkout" }))).toBe("Needs a purpose");
  });

  it("is finished only when it has been told what it does", () => {
    expect(stillNeeds(person({ name: "Ana Whitfield", role: "Engineer" }))).toBeNull();
    expect(stillNeeds(place({ name: "Checkout", purpose: "Builds and runs a product" }))).toBeNull();
  });

  it("does not count whitespace as an answer", () => {
    expect(stillNeeds(person({ name: "   " }))).toBe("Needs a name");
    expect(stillNeeds(person({ name: "Ana", role: "  " }))).toBe("Needs a role");
  });
});

describe("only the lone first person is asked about teammates", () => {
  /**
   * The reveal is the whole point of the sequence. Asking anybody else would
   * mean the team already existed — and the create-a-person flow deliberately
   * never asks which team somebody is in, for the same reason.
   */
  it("asks them, last, after who they are and what they do", () => {
    const steps = stepsFor("person", true);
    expect(steps.map((s) => s.key)).toEqual(["name", "role", "teammates"]);
  });

  it("does not ask anybody else", () => {
    expect(stepsFor("person", false).map((s) => s.key)).toEqual(["name", "role"]);
  });

  it("never asks a place about teammates", () => {
    expect(stepsFor("place", true).map((s) => s.key)).toEqual(["name", "purpose"]);
    expect(stepsFor("place", false).map((s) => s.key)).toEqual(["name", "purpose"]);
  });

  it("offers suggestions on the name step and never fills it in", () => {
    const [first] = stepsFor("person", true);
    expect(first.kind).toBe("text");
    if (first.kind !== "text") return;
    expect(first.suggestions.length).toBeGreaterThan(0);
    // A suggestion is something to press, not a default: a fresh person has no
    // name at all, which is what makes them breathe.
    expect(stillNeeds(person())).toBe("Needs a name");
  });
});
