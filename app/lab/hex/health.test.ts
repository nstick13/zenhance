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
  INSCRIBED,
  NODE_RING_SHARE,
  PERSON_RING_SPREAD,
  RING_CLEAR_PX,
  RING_WIDTH_MAX_PX,
  RING_WIDTH_MIN_PX,
  HEX_RING_LABELS,
  HEX_RING_SLOTS,
  healthColour,
  illustrativeWellbeing,
  ringAtDistance,
  ringBand,
  ringColour,
  ringReach,
  signalRollup,
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
  // A person: a small circle standing in a much larger tile.
  const PERSON = { mark: 55, host: 280 };
  // A team: its mark *is* its cell. A place overflows it by half a radius.
  const TEAM = { mark: 350, host: 350 };
  const PLACE = { mark: 546, host: 350 };

  it("anchors a person's stack outside their mark, with Greg's 15% on it", () => {
    const band = ringBand(PERSON.mark, PERSON.host, true, 0, 1)!;
    const bare = PERSON.mark + RING_CLEAR_PX + band.width / 2;
    expect(band.radius).toBeCloseTo(bare * PERSON_RING_SPREAD, 6);
    expect(band.radius).toBeGreaterThan(PERSON.mark);
  });

  it("keeps a person's whole stack inside their own tile", () => {
    for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
      const band = ringBand(PERSON.mark, PERSON.host, true, slot, 1)!;
      expect(band.radius + band.width / 2).toBeLessThanOrEqual(PERSON.host * INSCRIBED);
    }
  });

  it("anchors a structural node's stack at a third of its own radius", () => {
    expect(ringBand(TEAM.mark, TEAM.host, false, 0, 1)!.radius)
      .toBeCloseTo(TEAM.mark * NODE_RING_SHARE, 6);
    expect(ringBand(PLACE.mark, PLACE.host, false, 0, 1)!.radius)
      .toBeCloseTo(PLACE.mark * NODE_RING_SHARE, 6);
  });

  it("keeps a structural node's whole stack on its own face", () => {
    for (const node of [TEAM, PLACE]) {
      for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
        const band = ringBand(node.mark, node.host, false, slot, 1)!;
        expect(band.radius + band.width / 2).toBeLessThanOrEqual(node.mark * INSCRIBED);
      }
    }
  });

  it("holds its weight in screen pixels, so one zoom does not fatten it", () => {
    for (const scale of [0.05, 0.2, 1, 4]) {
      const band = ringBand(TEAM.mark, TEAM.host, false, 0, scale)!;
      const px = band.width * scale;
      expect(px).toBeGreaterThanOrEqual(RING_WIDTH_MIN_PX - 1e-9);
      expect(px).toBeLessThanOrEqual(RING_WIDTH_MAX_PX + 1e-9);
    }
  });

  it("refuses a ring it cannot pay for rather than drawing a thin one", () => {
    expect(ringBand(0.4, 0.4, false, 2, 1)).toBeNull();
    expect(ringBand(0, 350, true, 0, 1)).toBeNull();
  });
});

describe("ringAtDistance", () => {
  const TEAM = { mark: 350, host: 350 };
  const PERSON = { mark: 55, host: 280 };

  it("points at exactly what it draws, on every slot and both kinds of node", () => {
    for (const [node, person] of [[TEAM, false], [PERSON, true]] as const) {
      for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
        const band = ringBand(node.mark, node.host, person, slot, 1)!;
        expect(ringAtDistance(node.mark, node.host, person, 1, band.radius)).toBe(slot);
      }
    }
  });

  it("finds nothing in the empty middle or out past the stack", () => {
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, 2)).toBeNull();
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, TEAM.mark * 2)).toBeNull();
  });

  it("picks the nearer of two rings when the hand is between them", () => {
    const a = ringBand(TEAM.mark, TEAM.host, false, 0, 1)!;
    const b = ringBand(TEAM.mark, TEAM.host, false, 1, 1)!;
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, a.radius + 0.1)).toBe(0);
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, b.radius - 0.1)).toBe(1);
  });

  it("reaches no further than the stack it is told to skip for", () => {
    const reach = ringReach(TEAM.mark, TEAM.host, false, 1);
    const outer = ringBand(TEAM.mark, TEAM.host, false, HEX_RING_SLOTS.length - 1, 1)!;
    expect(reach).toBeGreaterThanOrEqual(outer.radius + outer.width / 2);
    expect(ringAtDistance(TEAM.mark, TEAM.host, false, 1, reach + 1)).toBeNull();
  });
});
