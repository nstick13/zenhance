import { describe, it, expect } from "vitest";
import {
  SEAT_RADIUS,
  UNIT_RADIUS,
  WORK_COL_GAP,
  angleDelta,
  angleOf,
  clampToSector,
  normalizeAngle,
  packRing,
  polar,
  relaxAngles,
  sectorContains,
  spreadRing,
  subdivideCircle,
  subdivideSector,
  unitRadius,
  workGridPoints,
  type Sector,
} from "../geometry";

const DEG = Math.PI / 180;

describe("angle helpers", () => {
  it("wraps into (-π, π]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
  });

  it("takes the short way round the ±π seam", () => {
    expect(angleDelta(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG);
    expect(angleDelta(-170 * DEG, 170 * DEG)).toBeCloseTo(-20 * DEG);
  });
});

describe("sectors", () => {
  const straddling: Sector = { center: Math.PI, halfSpan: 30 * DEG };

  it("contains angles across the ±π seam without special-casing", () => {
    expect(sectorContains(straddling, 175 * DEG)).toBe(true);
    expect(sectorContains(straddling, -175 * DEG)).toBe(true);
    expect(sectorContains(straddling, 100 * DEG)).toBe(false);
  });

  it("clamps an outside angle to the nearest edge", () => {
    const clamped = clampToSector(straddling, 100 * DEG);
    expect(Math.abs(angleDelta(straddling.center, clamped))).toBeCloseTo(30 * DEG);
    expect(clampToSector(straddling, -175 * DEG)).toBeCloseTo(-175 * DEG);
  });
});

describe("unitRadius", () => {
  it("is one size for every unit below the company", () => {
    // Greg, 2026-09-24: a team is at most twice a person's area, and
    // everything between a team and the company draws the same. Depth no
    // longer shrinks anything; size carries no meaning at present.
    expect(unitRadius(1)).toBe(UNIT_RADIUS);
    expect(unitRadius(2)).toBe(UNIT_RADIUS);
    expect(unitRadius(20)).toBe(UNIT_RADIUS);
  });

  it("keeps a unit to twice a person's area", () => {
    const area = (r: number) => Math.PI * r * r;
    expect(area(UNIT_RADIUS)).toBeCloseTo(2 * area(SEAT_RADIUS), 6);
  });

  it("leaves the company larger, so the map has an anchor", () => {
    expect(unitRadius(0)).toBeGreaterThan(unitRadius(1));
  });
});

describe("packRing", () => {
  it("centres a single item on the given angle", () => {
    expect(packRing(1, 10, 4, 300, 1.2, Math.PI)).toEqual([normalizeAngle(1.2)]);
  });

  it("packs siblings shoulder to shoulder around their parent's angle", () => {
    const angles = packRing(4, 20, 10, 400, 0, Math.PI);
    // Symmetric about the centre, and evenly stepped.
    expect(angles[0] + angles[3]).toBeCloseTo(0);
    const steps = angles.slice(1).map((a, i) => a - angles[i]);
    for (const s of steps) expect(s).toBeCloseTo(steps[0]);
  });

  it("compresses rather than overflowing the sector it is given", () => {
    const maxSpan = 20 * DEG;
    const angles = packRing(6, 40, 10, 200, 0, maxSpan);
    const span = angles[angles.length - 1] - angles[0];
    expect(span).toBeLessThanOrEqual(maxSpan + 1e-9);
  });

  it("leaves the rest of the circle empty — tight clusters, wide gaps", () => {
    const angles = packRing(3, 48, 14, 400, 0, Math.PI);
    const span = angles[angles.length - 1] - angles[0];
    expect(span).toBeLessThan(Math.PI / 2);
  });
});

describe("spreadRing", () => {
  it("spaces the company's own children evenly around the whole circle", () => {
    const angles = spreadRing(4, -Math.PI / 2);
    expect(angles).toHaveLength(4);
    for (let i = 1; i < angles.length; i++) {
      expect(Math.abs(angleDelta(angles[i - 1], angles[i]))).toBeCloseTo(Math.PI / 2);
    }
  });
});

describe("subdivideSector", () => {
  const parent: Sector = { center: 0, halfSpan: 60 * DEG };

  it("gives each child the angle nearest to it, cutting at the midpoints", () => {
    const kids = [-20 * DEG, 0, 20 * DEG];
    const sectors = subdivideSector(parent, kids);
    expect(sectors).toHaveLength(3);
    kids.forEach((a, i) => expect(sectorContains(sectors[i], a)).toBe(true));
    // Neighbours meet but never overlap: the boundary is the midpoint.
    expect(sectors[0].center + sectors[0].halfSpan).toBeCloseTo(sectors[1].center - sectors[1].halfSpan);
  });

  it("never reaches past the parent's own bounds", () => {
    const sectors = subdivideSector(parent, [-50 * DEG, 50 * DEG]);
    const low = sectors[0].center - sectors[0].halfSpan;
    const high = sectors[1].center + sectors[1].halfSpan;
    expect(low).toBeGreaterThanOrEqual(-60 * DEG - 1e-9);
    expect(high).toBeLessThanOrEqual(60 * DEG + 1e-9);
  });

  it("hands a lone child the parent's whole sector", () => {
    const [only] = subdivideSector(parent, [10 * DEG]);
    expect(only.halfSpan).toBeCloseTo(parent.halfSpan);
  });
});

describe("relaxAngles", () => {
  it("pushes overlapping siblings apart", () => {
    const out = relaxAngles([0, 0.02, 0.04], 0.3, [false, false, false]);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.3 - 1e-3);
    }
  });

  it("moves a pinned angle far less than a free one", () => {
    const start = [0, 0.05];
    const out = relaxAngles(start, 0.6, [true, false]);
    expect(Math.abs(out[0] - start[0])).toBeLessThan(Math.abs(out[1] - start[1]));
  });

  it("leaves angles that already clear each other exactly where they were", () => {
    const start = [0, 1, 2];
    expect(relaxAngles(start, 0.4, [false, false, false])).toEqual(start.map(normalizeAngle));
  });

  it("closes the loop when the ring wraps the whole circle", () => {
    // Two nodes either side of the ±π seam must be seen as neighbours.
    const out = relaxAngles([3.0, -3.0], 1.0, [false, false], true);
    expect(Math.abs(angleDelta(out[0], out[1]))).toBeGreaterThan(0.9);
  });

  it("never demands more room than the circle has", () => {
    const out = relaxAngles([0, 0.1, 0.2, 0.3], 3, [false, false, false, false], true);
    expect(out.every((a) => Number.isFinite(a))).toBe(true);
  });
});

describe("subdivideCircle", () => {
  it("gives every child a sector containing it, with no seam at ±π", () => {
    const kids = [-2.5, -0.5, 1.0, 2.8];
    const sectors = subdivideCircle(kids);
    kids.forEach((a, i) => expect(sectorContains(sectors[i], a)).toBe(true));
  });

  it("divides the whole circle between them", () => {
    const kids = spreadRing(5, 0);
    const total = subdivideCircle(kids).reduce((sum, s) => sum + s.halfSpan * 2, 0);
    expect(total).toBeCloseTo(Math.PI * 2, 5);
  });

  it("gives a wider sector to the child with more room beside it", () => {
    const [tight, , roomy] = subdivideCircle([0, 0.4, 2.4]);
    expect(roomy.halfSpan).toBeGreaterThan(tight.halfSpan);
  });
});

describe("workGridPoints", () => {
  const seat = polar(0.7, 120);
  const axis = 0.7;

  it("marches outward along the seat's own connection axis", () => {
    const points = workGridPoints(6, seat, axis);
    const seatR = Math.hypot(seat.x, seat.y);
    const radii = points.map((p) => Math.hypot(p.x, p.y));
    for (const r of radii) expect(r).toBeGreaterThan(seatR);
    // Row 3 is further out than row 1.
    expect(radii[4]).toBeGreaterThan(radii[0]);
  });

  it("is two abreast, straddling the axis", () => {
    const points = workGridPoints(4, seat, axis);
    // Project each point onto the perpendicular; pairs sit either side.
    const perp = points.map((p) => (p.x - seat.x) * -Math.sin(axis) + (p.y - seat.y) * Math.cos(axis));
    expect(perp[0]).toBeCloseTo(-WORK_COL_GAP / 2);
    expect(perp[1]).toBeCloseTo(WORK_COL_GAP / 2);
    expect(perp[2]).toBeCloseTo(-WORK_COL_GAP / 2);
    expect(perp[3]).toBeCloseTo(WORK_COL_GAP / 2);
  });

  it("rides an odd last item on the axis itself", () => {
    const points = workGridPoints(5, seat, axis);
    const last = points[4];
    const perp = (last.x - seat.x) * -Math.sin(axis) + (last.y - seat.y) * Math.cos(axis);
    expect(perp).toBeCloseTo(0);
  });

  it("clears the seat it belongs to", () => {
    const points = workGridPoints(8, seat, axis);
    for (const p of points) {
      expect(Math.hypot(p.x - seat.x, p.y - seat.y)).toBeGreaterThan(SEAT_RADIUS);
    }
  });

  it("draws nothing for nobody's work", () => {
    expect(workGridPoints(0, seat, axis)).toEqual([]);
  });
});

describe("polar/angleOf round trip", () => {
  it("survives the trip out and back", () => {
    for (const a of [0, 1, -2.5, Math.PI, -Math.PI / 3]) {
      expect(angleOf(polar(a, 250))).toBeCloseTo(normalizeAngle(a));
    }
  });
});
