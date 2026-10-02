/**
 * Greg's rule for where a team's people stand, 2026-10-02.
 *
 * *"People should orbit on 'rings' that are offsets of the node hexagon. They
 * gather on the side opposite the connection line, with one exception — the
 * team lead, who sits near the connection line. They do not sit 'inside' the
 * team node — but they should sit inside the host tile."*
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PEOPLE_RINGS,
  PERSON_SCALE,
  SEAT_RING_GAP,
  capacity,
  hexRingParam,
  placePeople,
  pointOnHexRing,
  ringsBetween,
  type SeatRequest,
} from "@/lib/map/layout/hex/people";
import { hexSizeFor, nodeScale } from "@/lib/map/layout/hex/scene";
import { SEAT_RADIUS } from "@/lib/map/layout/geometry";

const CELL = hexSizeFor("roomy");
const SEAT = SEAT_RADIUS * PERSON_SCALE;
const GAP = SEAT_RING_GAP;
const TEAM_NODE = CELL * nodeScale(8, 8);
const CENTRE = { x: 0, y: 0 };

/** Signed distance outward from a concentric hexagon of circumradius `R`,
 *  measured independently of the layout code: positive means outside it. */
const beyond = (p: { x: number; y: number }, R: number) => {
  let worst = -Infinity;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6; // the six edge normals
    worst = Math.max(worst, p.x * Math.cos(a) + p.y * Math.sin(a) - (R * Math.sqrt(3)) / 2);
  }
  return worst;
};

const team = (n: number): SeatRequest[] => [
  { id: "lead", kind: "lead" },
  ...Array.from({ length: n - 1 }, (_, i) => ({ id: `p${i}`, kind: "person" as const })),
];

const seat = (n: number, homeAngle = Math.PI / 2) =>
  placePeople({
    centre: CENTRE, nodeR: TEAM_NODE, cellR: CELL, seatR: SEAT, gap: GAP, homeAngle,
    seats: team(n),
  });

describe("a hexagonal ring", () => {
  it("steps evenly in distance, not in angle — or people bunch at the corners", () => {
    const r = 100;
    const gaps: number[] = [];
    for (let i = 0; i < 24; i++) {
      const a = pointOnHexRing(CENTRE, r, (i * 6) / 24);
      const b = pointOnHexRing(CENTRE, r, ((i + 1) * 6) / 24);
      gaps.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
    // Equal perimeter steps: the only variation is the chord cutting a corner.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(r * 0.04);
  });

  it("answers where a direction leaves the ring, the same way at every radius", () => {
    for (const angle of [0, 0.3, 1.1, Math.PI / 2, 3, 4.5, 6]) {
      const t = hexRingParam(angle);
      for (const r of [40, 180, 900]) {
        const p = pointOnHexRing(CENTRE, r, t);
        const got = Math.atan2(p.y, p.x);
        const want = Math.atan2(Math.sin(angle), Math.cos(angle));
        expect(Math.abs(got - want)).toBeLessThan(1e-9);
      }
    }
  });
});

describe("the rings a cell has room for", () => {
  it("gives a team node the four Greg asked for, and a full cell none", () => {
    expect(ringsBetween(TEAM_NODE, CELL, SEAT, GAP).length).toBe(MAX_PEOPLE_RINGS);
    expect(ringsBetween(CELL, CELL, SEAT, GAP)).toEqual([]);
  });

  it("holds twice the fifty Greg asked to see", () => {
    expect(capacity(TEAM_NODE, CELL, SEAT, GAP)).toBeGreaterThan(100);
  });

  /**
   * Greg, 2026-10-02: *"make the way the people arrange themselves on each rung
   * nice and neat — please write a line of code that governs an evenly-spaced
   * pattern along the rungs."*
   *
   * A whole number per side is that line. It is what makes the four rings a
   * honeycomb rather than four unrelated arcs.
   */
  it("puts a whole number of people on each side, six more per ring out", () => {
    const rings = ringsBetween(TEAM_NODE, CELL, SEAT, GAP);
    expect(rings.map((r) => r.slots)).toEqual([18, 24, 30, 36]);
    for (const ring of rings) expect(ring.slots % 6).toBe(0);
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].slots - rings[i - 1].slots).toBe(6);
    }
  });

  it("keeps the spacing along a ring at or above a full step, never below", () => {
    const step = 2 * SEAT + GAP;
    for (const node of [TEAM_NODE, CELL * 0.5, CELL * 0.75]) {
      for (const ring of ringsBetween(node, CELL, SEAT, GAP)) {
        expect((6 * ring.r) / ring.slots).toBeGreaterThanOrEqual(step - 1e-9);
      }
    }
  });
});

describe("where a team's people stand", () => {
  it("never puts anyone inside the node — they orbit it, they do not sit in it", () => {
    for (const s of seat(50)) expect(beyond(s, TEAM_NODE)).toBeGreaterThanOrEqual(SEAT - 1e-9);
  });

  it("never lets anyone cross into the next cell, which is somebody else's", () => {
    for (const n of [1, 4, 12, 50, 108]) {
      for (const s of seat(n)) expect(beyond(s, CELL)).toBeLessThanOrEqual(-SEAT + 1e-9);
    }
  });

  it("never overlaps two people, at any size", () => {
    for (const n of [4, 12, 28, 50, 108, 130]) {
      const out = seat(n);
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const d = Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y);
          expect(d).toBeGreaterThanOrEqual(2 * SEAT);
        }
      }
    }
  });

  it("puts the lead by the connection line and everybody else opposite it", () => {
    const home = Math.PI / 2;
    const out = seat(6, home);
    const lead = out.find((s) => s.kind === "lead")!;
    const towardHome = (s: { x: number; y: number }) =>
      (s.x * Math.cos(home) + s.y * Math.sin(home)) / Math.hypot(s.x, s.y);
    // Within half a slot of the chain, not exactly on it: since the slots are
    // anchored to the hexagon's corners the lead takes the nearest one, which
    // on an eighteen-slot ring is at worst about ten degrees off. That is the
    // price of the pattern lining up, and it is worth paying.
    expect(towardHome(lead)).toBeGreaterThan(Math.cos(Math.PI / 16));
    for (const s of out) if (s !== lead) expect(towardHome(s)).toBeLessThan(0);
  });

  it("fills the near ring before reaching for the next one", () => {
    expect(new Set(seat(12).map((s) => s.ring))).toEqual(new Set([0]));
    expect(new Set(seat(50).map((s) => s.ring))).toEqual(new Set([0, 1, 2]));
  });

  it("seats everyone it was asked to, up to what the tile can hold", () => {
    for (const n of [1, 4, 50, 108]) expect(seat(n)).toHaveLength(n);
  });

  /** Four rings is a real ceiling, and the honest answer past it is to leave
   *  people out rather than draw them over somebody else's tile. */
  it("leaves people out rather than spilling, past what four rings hold", () => {
    expect(seat(130)).toHaveLength(capacity(TEAM_NODE, CELL, SEAT, GAP));
  });

  /** Every dot on a radial line out from the centre, because the slots are
   *  anchored to the hexagon's own corners rather than to where the crowd
   *  happens to start. */
  it("lines the rings up on the same spokes, so it reads as one pattern", () => {
    const TAU = Math.PI * 2;
    const out = seat(108);
    const corner = out.filter((s) => {
      const a = ((Math.atan2(s.y, s.x) % TAU) + TAU) % TAU;
      return [0, 1, 2, 3, 4, 5].some((i) => {
        const d = Math.abs(a - (Math.PI / 3) * i);
        return Math.min(d, TAU - d) < 1e-9;
      });
    });
    // One dot on each of the six corners of each of the four rings.
    expect(corner).toHaveLength(24);
  });

  it("seats nobody rather than spilling, when the node leaves no room", () => {
    expect(placePeople({
      centre: CENTRE, nodeR: CELL, cellR: CELL, seatR: SEAT, gap: GAP,
      homeAngle: 0, seats: team(4),
    })).toEqual([]);
  });

  it("turns with the connection line rather than being fixed to the page", () => {
    const a = seat(8, 0);
    const b = seat(8, Math.PI / 3);
    // Same shape, rotated: every distance from the centre is preserved.
    const radii = (out: typeof a) => out.map((s) => +Math.hypot(s.x, s.y).toFixed(6)).sort();
    expect(radii(a)).toEqual(radii(b));
    expect(a[0].x).not.toBeCloseTo(b[0].x, 3);
  });
});
