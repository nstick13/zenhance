/**
 * The rings' arithmetic and geometry, argued with rather than trusted.
 *
 * Three things are worth a test here and nothing else is: **who a node's rings
 * speak for** (because a lead wearing their team's average instead of their
 * own would hide the one person going under), **that the roll-up agrees with
 * the engine it duplicates four lines of**, and **where a ring lands** —
 * including that what you can point at is exactly what you can see, which is
 * the property that makes a hover honest.
 */
import { describe, expect, it } from "vitest";
import { strainOf, unitProgress } from "@/lib/map/signal/progress";
import type { MockTask } from "@/lib/mock/personTasks";
import {
  PERSON_RING_ROOM,
  RING_GAP_MIN_PX,
  RING_GAP_RATIO,
  RING_WIDTH_MAX_PX,
  RING_WIDTH_MIN_PX,
  RING_WIDTH_SHARE,
  HEX_RING_LABELS,
  HEX_RING_SLOTS,
  healthColour,
  illustrativeWellbeing,
  RING_SUMMARY_WEIGHT,
  SUMMARY_SLOT,
  ringAtDistance,
  ringBand,
  ringColour,
  ringReach,
  ringSummary,
  signalRollup,
  summaryBand,
  STRAIN_COLOUR,
  WORK_RING_COLOUR,
} from "./health";

const task = (status: MockTask["status"], points: number): MockTask => ({
  id: `${status}-${points}-${Math.random()}`,
  title: "Invented", status, priority: "medium", points,
  tag: "General", value: null, essentialNote: null,
});

/** A three-rung company: a team with a manager who has two reports, plus an
 *  empty team beside it. The shape every assertion below needs. */
const COMPANY = {
  children: new Map<string, string[]>([
    ["company", ["team", "empty"]],
    ["team", ["person:boss"]],
    ["person:boss", ["person:a", "person:b"]],
    ["person:a", []],
    ["person:b", []],
    ["empty", []],
  ]),
  people: new Set(["person:boss", "person:a", "person:b"]),
};

const BOARDS: Record<string, MockTask[]> = {
  "person:boss": [task("done", 3), task("backlog", 5)],
  "person:a": [task("done", 2), task("in_progress", 4)],
  "person:b": [task("review", 1), task("backlog", 1), task("done", 2)],
};

const roll = (scores: Record<string, number | null>, boards = BOARDS) =>
  signalRollup(
    [...COMPANY.children.keys()],
    (id: string) => COMPANY.children.get(id) ?? [],
    (id: string) => COMPANY.people.has(id),
    (id: string) => boards[id] ?? [],
    (id: string) => scores[id] ?? null,
  );

describe("illustrativeWellbeing", () => {
  it("is the same figure every time the page is opened", () => {
    expect(illustrativeWellbeing("person:ana")).toBe(illustrativeWellbeing("person:ana"));
  });

  it("stays inside the 0..1 the ring draws", () => {
    for (let i = 0; i < 400; i++) {
      const v = illustrativeWellbeing(`person:${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("invents a company with all three verdicts in it, not one flat colour", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(strainOf(illustrativeWellbeing(`person:${i}`)));
    expect([...seen].sort()).toEqual(["ok", "risk", "watch"]);
  });
});

describe("the colours", () => {
  it("takes the health thresholds from the signal engine, so there is one definition", () => {
    for (const v of [0, 0.2, 0.44, 0.45, 0.7, 0.72, 0.9, 1]) {
      expect(healthColour(v)).toBe(STRAIN_COLOUR[strainOf(v)]);
      expect(ringColour("health", v)).toBe(STRAIN_COLOUR[strainOf(v)]);
    }
  });

  it("gives the work rings a fixed hue, because there is no good amount of sprint", () => {
    expect(ringColour("sprint", 0.1)).toBe(ringColour("sprint", 0.9));
    expect(ringColour("delivery", 0.1)).toBe(WORK_RING_COLOUR.delivery);
  });
});

describe("the three rings", () => {
  it("puts health against the node and the work figures beyond it", () => {
    expect(HEX_RING_SLOTS).toEqual(["health", "sprint", "delivery"]);
    expect(Object.keys(HEX_RING_LABELS).sort()).toEqual([...HEX_RING_SLOTS].sort());
  });

  it("stacks outward, so the ring against the node never moves", () => {
    const radii = HEX_RING_SLOTS.map((_, i) => ringBand(10, 60, true, i, 1)!.radius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(new Set(radii).size).toBe(3);
  });
});

describe("signalRollup", () => {
  it("gives a person their own figures and nobody else's", () => {
    // The boss is fine; their two reports are not. A branch average would
    // paint the boss amber and hide exactly the thing the ring is for.
    const out = roll({ "person:boss": 1, "person:a": 0.2, "person:b": 0.2 });
    expect(out.get("person:boss")).toEqual(
      unitProgress([{ tasks: BOARDS["person:boss"], health: 1 }]),
    );
  });

  it("speaks for the whole branch on a place, not just who sits on it", () => {
    const scores = { "person:boss": 1, "person:a": 0.4, "person:b": 0.4 };
    const out = roll(scores);
    const everyone = Object.entries(BOARDS).map(([id, tasks]) => ({
      tasks, health: scores[id as keyof typeof scores],
    }));
    expect(out.get("team")).toEqual(unitProgress(everyone));
    expect(out.get("company")).toEqual(unitProgress(everyone));
  });

  it("agrees with the engine it duplicates, which is why duplicating it is allowed", () => {
    // The roll-up accumulates counters instead of building a member list per
    // node, because the latter is quadratic. This is the check that the
    // shortcut computes the same three numbers.
    const scores = { "person:boss": 0.9, "person:a": 0.1, "person:b": 0.55 };
    const out = roll(scores)!;
    const members = Object.entries(BOARDS).map(([id, tasks]) => ({
      tasks, health: scores[id as keyof typeof scores],
    }));
    const engine = unitProgress(members);
    const mine = out.get("company")!;
    expect(mine.delivery).toBeCloseTo(engine.delivery!, 12);
    expect(mine.sprint).toBeCloseTo(engine.sprint!, 12);
    expect(mine.health).toBeCloseTo(engine.health!, 12);
    expect(mine.people).toBe(engine.people);
    expect(mine.total).toBe(engine.total);
    expect(mine.done).toBe(engine.done);
  });

  it("rolls up through a person, so a manager's reports are never dropped", () => {
    expect(roll({ "person:boss": 1, "person:a": 0, "person:b": 0.5 }).get("team")?.people).toBe(3);
  });

  it("reports no measurement rather than a measured zero", () => {
    expect(roll({ "person:boss": 1 }).get("empty")).toEqual({
      delivery: null, sprint: null, health: null, people: 0, done: 0, total: 0,
    });
  });

  it("gives a person with no board and no score no rings rather than empty ones", () => {
    const out = roll({}, {});
    expect(out.get("person:a")).toEqual({
      delivery: null, sprint: null, health: null, people: 1, done: 0, total: 0,
    });
  });

  it("returns rather than hangs on a cycle", () => {
    const children = new Map([["a", ["b"]], ["b", ["a"]]]);
    const out = signalRollup(
      ["a", "b"], (id) => children.get(id) ?? [], () => false, () => [], () => null,
    );
    expect(out.size).toBe(2);
  });
});

describe("ringBand", () => {
  /**
   * **Every node is a small coloured dot on a white tile** (Greg,
   * 2026-11-09). A person's dot is the unit; a team's and a place's are twice
   * it, the master centre's three times. What differs between them is the
   * tile: a team's is its cell, a place's the cell and half a radius more,
   * the master centre's three cell radii.
   */
  const PERSON = { mark: 55, host: 280 };
  const TEAM = { mark: 110, host: 350 };
  const PLACE = { mark: 110, host: 546 };
  const MASTER = { mark: 165, host: 1050 };

  /** The weight and the spacing at a given zoom, worked out the way
   *  `ringBand` works them out — so a test can say where a ring *should* be
   *  without restating the implementation line for line. */
  const weight = (mark: number, scale: number) => {
    const w = Math.min(RING_WIDTH_MAX_PX, Math.max(RING_WIDTH_MIN_PX, mark * scale * RING_WIDTH_SHARE));
    return { w, gap: Math.max(RING_GAP_MIN_PX, w * RING_GAP_RATIO) };
  };

  it("stands the innermost ring off by one whole empty slot", () => {
    // Greg, 2026-11-10: "the offset equal to one ring-width plus whatever
    // spacing exists between the rings already (as if there is a missing
    // ring)". So the first ring drawn sits where a *second* ring would, had
    // one been drawn against the node's own edge.
    for (const node of [PERSON, TEAM, PLACE, MASTER]) {
      for (const scale of [0.1, 1, 3]) {
        const { w, gap } = weight(node.mark, scale);
        const band = ringBand(node.mark, node.host, node === PERSON, 0, scale);
        if (!band) continue;
        expect((band.radius - node.mark) * scale).toBeCloseTo(w + gap + w / 2, 6);
      }
    }
  });

  it("hugs the node at every zoom, which is the whole of the /org model", () => {
    // The failure this replaces: the stack used to be anchored at a third of
    // the node's *tile*, a world distance, so it ballooned on the glass as
    // you zoomed in while the line capped out — "the rings themselves become
    // very skinny". Every gap is in screen pixels now, so the distance from
    // the dot to its outermost ring is bounded however far in you go.
    const reaches = [0.1, 0.5, 1, 4, 16].map((scale) => {
      const band = ringBand(MASTER.mark, MASTER.host, false, HEX_RING_SLOTS.length - 1, scale)!;
      return (band.radius - MASTER.mark) * scale;
    });
    for (const px of reaches) expect(px).toBeLessThan(120);
    // And it never collapses onto the node either.
    for (const px of reaches) expect(px).toBeGreaterThan(RING_WIDTH_MIN_PX);
  });

  it("spaces the stack evenly, one ring plus one gap at a time", () => {
    for (const scale of [0.2, 1, 5]) {
      const { w, gap } = weight(TEAM.mark, scale);
      const steps = HEX_RING_SLOTS.map((_, i) => ringBand(TEAM.mark, TEAM.host, false, i, scale)!.radius);
      for (let i = 1; i < steps.length; i++) {
        expect((steps[i] - steps[i - 1]) * scale).toBeCloseTo(w + gap, 6);
      }
    }
  });

  it("is twice the weight it was before 2026-11-10", () => {
    // The old range was 2.2–8 screen pixels; Greg asked for "2x thicker".
    expect(RING_WIDTH_MIN_PX).toBeCloseTo(2 * 2.2, 6);
    expect(RING_WIDTH_MAX_PX).toBeCloseTo(2 * 8, 6);
  });

  it("holds its weight in screen pixels, so one zoom does not fatten it", () => {
    for (const scale of [0.05, 0.2, 1, 4]) {
      const band = ringBand(TEAM.mark, TEAM.host, false, 0, scale)!;
      const px = band.width * scale;
      expect(px).toBeGreaterThanOrEqual(RING_WIDTH_MIN_PX - 1e-9);
      expect(px).toBeLessThanOrEqual(RING_WIDTH_MAX_PX + 1e-9);
    }
  });

  it("leaves every dot clear of the ring that hugs it", () => {
    for (const node of [PERSON, TEAM, PLACE, MASTER]) {
      const band = ringBand(node.mark, node.host, node === PERSON, 0, 1);
      if (!band) continue;
      expect(band.radius - band.width / 2).toBeGreaterThan(node.mark);
    }
  });

  /**
   * **The one ceiling left is the crowd batch's.** A thousand people's rings
   * are merged into nine strokes, which is only safe while no two stacks
   * overlap; a structural node has no neighbour close enough to collide with
   * and is allowed to overflow, exactly as its tile does.
   */
  it("refuses a person's ring that would reach into the next cell", () => {
    for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
      const band = ringBand(PERSON.mark, PERSON.host, true, slot, 1);
      if (!band) continue;
      expect(band.radius + band.width / 2).toBeLessThanOrEqual(PERSON.host * PERSON_RING_ROOM);
    }
    // Squeeze the room and the outermost one goes rather than being drawn thin.
    expect(ringBand(PERSON.mark, PERSON.mark * 1.2, true, 2, 1)).toBeNull();
  });

  it("lets the master centre keep all three rings at the outermost zoom", () => {
    // What the old tile-measured ceiling took away: at four pixels a cell the
    // company's dial is the only reading on the glass, and it used to lose
    // its outer ring exactly there.
    for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
      expect(ringBand(MASTER.mark, MASTER.host, false, slot, 4 / 364)).not.toBeNull();
    }
  });

  it("refuses a node with no size rather than inventing one", () => {
    expect(ringBand(0, 350, true, 0, 1)).toBeNull();
    expect(ringBand(55, 0, true, 0, 1)).toBeNull();
    expect(ringBand(55, 280, true, -1, 1)).toBeNull();
    // A structural node with no room is *not* refused: it has no neighbour to
    // collide with, and at the outermost zoom its dial should be the biggest
    // thing on the glass.
    expect(ringBand(0.4, 0.4, false, 2, 1)).not.toBeNull();
  });
});

/**
 * The one ring that stands in for the three while there is no room to read
 * them — Greg, 2026-11-11. What matters is that it *is* a summary rather than
 * a fourth number, that it lies exactly on the innermost of the three so the
 * handover reads as a dissolve, and that it ends the handover indistinguishable
 * from the health ring.
 */
describe("ringSummary and summaryBand", () => {
  const PERSON = { mark: 55, host: 280 };
  const read = (health: number | null, sprint: number | null, delivery: number | null) =>
    ({ health, sprint, delivery, people: 1, done: 0, total: 0 });

  it("sweeps the mean of the three figures, not a fourth number", () => {
    expect(ringSummary(read(0.3, 0.6, 0.9))!.value).toBeCloseTo(0.6, 6);
    // And the mean of whichever exist, so a node with no work still reads.
    expect(ringSummary(read(0.4, null, null))!.value).toBeCloseTo(0.4, 6);
    expect(ringSummary(read(null, 0.2, 0.8))!.value).toBeCloseTo(0.5, 6);
  });

  it("takes its colour from the health verdict, which is the only judgement", () => {
    // Work nearly finished does not make a struggling team green.
    expect(ringSummary(read(0.2, 1, 1))!.colour).toBe(healthColour(0.2));
    expect(ringSummary(read(0.9, 0, 0))!.colour).toBe(healthColour(0.9));
    // With no health figure it colours itself by its own sweep instead.
    expect(ringSummary(read(null, 0.1, 0.1))!.colour).toBe(healthColour(0.1));
  });

  it("says nothing when there is nothing to say", () => {
    expect(ringSummary(read(null, null, null))).toBeNull();
  });

  it("sits exactly where the innermost of the three sits, at every zoom", () => {
    for (const scale of [0.05, 0.14, 0.3, 0.5, 1, 4]) {
      const inner = ringBand(PERSON.mark, PERSON.host, true, 0, scale)!;
      const one = summaryBand(PERSON.mark, PERSON.host, true, scale, 0)!;
      expect(one.radius).toBeCloseTo(inner.radius, 9);
    }
  });

  it("is heavier while it is alone and one ring's weight once the three are in", () => {
    const inner = ringBand(PERSON.mark, PERSON.host, true, 0, 0.3)!;
    const alone = summaryBand(PERSON.mark, PERSON.host, true, 0.3, 0)!;
    const given = summaryBand(PERSON.mark, PERSON.host, true, 0.3, 1)!;
    expect(alone.width).toBeCloseTo(inner.width * RING_SUMMARY_WEIGHT, 9);
    expect(given.width).toBeCloseTo(inner.width, 9);
    // And it eases, rather than stepping, between the two.
    const half = summaryBand(PERSON.mark, PERSON.host, true, 0.3, 0.5)!;
    expect(half.width).toBeGreaterThan(given.width);
    expect(half.width).toBeLessThan(alone.width);
  });
});

describe("ringAtDistance", () => {
  const TEAM = { mark: 110, host: 350 };
  const PERSON = { mark: 55, host: 280 };
  /** Past the handover, where the three rings are what is drawn. */
  const THREE = 1;
  /** Before it, where one summary ring is. */
  const ONE = 0;

  it("points at exactly what it draws, on every slot and both kinds of node", () => {
    for (const [node, person] of [[TEAM, false], [PERSON, true]] as const) {
      for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
        const band = ringBand(node.mark, node.host, person, slot, 1)!;
        expect(ringAtDistance(node.mark, node.host, person, 1, band.radius, THREE)).toBe(slot);
      }
    }
  });

  it("finds nothing in the empty middle or out past the stack", () => {
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, 2, THREE)).toBeNull();
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, TEAM.host * 2, THREE)).toBeNull();
  });

  it("picks the nearer of two rings when the hand is between them", () => {
    const a = ringBand(TEAM.mark, TEAM.host, false, 0, 1)!;
    const b = ringBand(TEAM.mark, TEAM.host, false, 1, 1)!;
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, a.radius + 0.1, THREE)).toBe(0);
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, b.radius - 0.1, THREE)).toBe(1);
  });

  it("reaches no further than the stack it is told to skip for", () => {
    const reach = ringReach(TEAM.mark, TEAM.host, false, 1, THREE);
    const outer = ringBand(TEAM.mark, TEAM.host, false, HEX_RING_SLOTS.length - 1, 1)!;
    expect(reach).toBeGreaterThanOrEqual(outer.radius + outer.width / 2);
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, reach + 1, THREE)).toBeNull();
  });

  /**
   * **The whole point of threading the handover through the hand.** While one
   * ring is drawn, the two outer bands are not there — and a hover that claimed
   * a sprint figure out in empty glass would break the rule this file exists to
   * keep.
   */
  it("offers the summary, and only the summary, while one ring is what is drawn", () => {
    const one = summaryBand(TEAM.mark, TEAM.host, false, 1, ONE)!;
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, one.radius, ONE)).toBe(SUMMARY_SLOT);
    for (const slot of [1, 2]) {
      const band = ringBand(TEAM.mark, TEAM.host, false, slot, 1)!;
      expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, band.radius, ONE)).toBeNull();
    }
  });

  it("stops offering the summary once the three have taken over", () => {
    const one = summaryBand(TEAM.mark, TEAM.host, false, 1, THREE)!;
    // It is still pointable — it is lying on the health ring — but it answers
    // as that ring, because that is what the eye is reading by then.
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, one.radius, THREE)).toBe(0);
  });

  it("reaches only as far as the one ring while the one ring is alone", () => {
    const near = ringReach(TEAM.mark, TEAM.host, false, 1, ONE);
    const far = ringReach(TEAM.mark, TEAM.host, false, 1, THREE);
    expect(near).toBeLessThan(far);
    const one = summaryBand(TEAM.mark, TEAM.host, false, 1, ONE)!;
    expect(near).toBeGreaterThanOrEqual(one.radius + one.width / 2);
  });
});
