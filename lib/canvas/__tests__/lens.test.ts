import { describe, it, expect } from "vitest";
import {
  normalizeLens,
  DEFAULT_LENS,
  isDefaultLens,
  disciplineColors,
  DISCIPLINE_RAMP,
  personColor,
  personLabel,
  buildLegend,
  initialsOf,
  NO_VALUE_COLOR,
  EMPLOYMENT_COLORS,
  type Lens,
} from "@/lib/canvas/lens";
import type { CanvasPerson } from "@/lib/canvas/buildCanvasMap";

// --- fixtures --------------------------------------------------------------

function person(over: Partial<CanvasPerson> & { id: string; name: string }): CanvasPerson {
  return {
    kind: "person",
    x: 0,
    y: 0,
    title: null,
    homeId: "team1",
    costPerMonth: 0,
    managerId: null,
    lastVacationAt: null,
    startDate: null,
    skills: [],
    growthFocus: null,
    disciplineId: null,
    employment: "unknown",
    location: null,
    timezone: null,
    allocations: [],
    crossCuttingTier: null,
    ...over,
  } as CanvasPerson;
}

const utilColor = (pct: number) => (pct > 100 ? "#ef4444" : pct === 0 ? "#5c6570" : "#22c55e");
const lens = (over: Partial<Lens> = {}): Lens => ({ ...DEFAULT_LENS, ...over });

const ctx = (l: Lens, over: Partial<Parameters<typeof personColor>[1]> = {}) => ({
  lens: l,
  utilisation: 100,
  utilColor,
  disciplineColor: new Map<string, string>(),
  streamHue: null,
  ...over,
});

// --- normalize -------------------------------------------------------------

describe("normalizeLens", () => {
  it("falls back to defaults for junk", () => {
    expect(normalizeLens(null)).toEqual(DEFAULT_LENS);
    expect(normalizeLens("nope")).toEqual(DEFAULT_LENS);
    expect(normalizeLens(42)).toEqual(DEFAULT_LENS);
    expect(normalizeLens({})).toEqual(DEFAULT_LENS);
  });

  it("keeps a valid field even when the other is invalid", () => {
    // A blob written by a future build must not cost the user the setting the
    // current build still understands.
    expect(normalizeLens({ colorBy: "discipline", labelBy: "hologram" })).toEqual({
      colorBy: "discipline",
      labelBy: "name",
    });
  });

  it("drops unknown keys", () => {
    expect(normalizeLens({ colorBy: "stream", labelBy: "initials", zoom: 4 })).toEqual({
      colorBy: "stream",
      labelBy: "initials",
    });
  });

  it("knows the default lens", () => {
    expect(isDefaultLens(DEFAULT_LENS)).toBe(true);
    expect(isDefaultLens(lens({ colorBy: "discipline" }))).toBe(false);
  });
});

// --- colour ----------------------------------------------------------------

describe("disciplineColors", () => {
  it("prefers the row's own colour and falls back to the ramp", () => {
    const m = disciplineColors([
      { id: "d1", name: "Engineering", color: "#123456" },
      { id: "d2", name: "QA", color: null },
    ]);
    expect(m.get("d1")).toBe("#123456");
    expect(m.get("d2")).toBe(DISCIPLINE_RAMP[1]);
  });

  it("wraps the ramp rather than running out", () => {
    const many = Array.from({ length: DISCIPLINE_RAMP.length + 1 }, (_, i) => ({
      id: `d${i}`,
      name: `D${i}`,
      color: null,
    }));
    const m = disciplineColors(many);
    expect(m.get(`d${DISCIPLINE_RAMP.length}`)).toBe(DISCIPLINE_RAMP[0]);
  });
});

describe("personColor", () => {
  const dev = person({ id: "p1", name: "Ada Byron", disciplineId: "d1", employment: "contractor" });

  it("defaults to utilisation", () => {
    expect(personColor(dev, ctx(lens(), { utilisation: 120 }))).toBe("#ef4444");
  });

  it("colours by discipline", () => {
    const c = ctx(lens({ colorBy: "discipline" }), {
      disciplineColor: new Map([["d1", "#0369a1"]]),
    });
    expect(personColor(dev, c)).toBe("#0369a1");
  });

  it("greys a missing discipline instead of borrowing a ramp slot", () => {
    const nobody = person({ id: "p2", name: "Nemo" });
    expect(personColor(nobody, ctx(lens({ colorBy: "discipline" })))).toBe(NO_VALUE_COLOR);
  });

  it("colours by employment from the fixed enum map", () => {
    expect(personColor(dev, ctx(lens({ colorBy: "employment" })))).toBe(
      EMPLOYMENT_COLORS.contractor,
    );
  });

  it("colours by home stream hue", () => {
    const c = ctx(lens({ colorBy: "stream" }), { streamHue: "#9d174d" });
    expect(personColor(dev, c)).toBe("#9d174d");
    // A person with no resolvable home stream must not fall through to a
    // utilisation colour — that would read as a status.
    expect(personColor(dev, ctx(lens({ colorBy: "stream" })))).toBe(NO_VALUE_COLOR);
  });
});

// --- legend ----------------------------------------------------------------

describe("buildLegend", () => {
  const people = [
    person({ id: "p1", name: "A", disciplineId: "d1", employment: "fte", allocations: [{ unitId: "t1", pct: 100 }] as CanvasPerson["allocations"] }),
    person({ id: "p2", name: "B", disciplineId: "d1", employment: "contractor", allocations: [{ unitId: "t1", pct: 120 }] as CanvasPerson["allocations"] }),
    person({ id: "p3", name: "C", employment: "unknown" }),
  ];

  const legendCtx = {
    utilisationOf: (p: CanvasPerson) => p.allocations.reduce((s, a) => s + a.pct, 0),
    disciplineColor: new Map([["d1", "#0369a1"]]),
    disciplineName: new Map([["d1", "Engineering"]]),
    streamHueOf: () => "#0e7490",
    streamNameOf: () => "Earthlight",
    employmentLabel: { fte: "Employee", contractor: "Contractor", vendor: "Vendor", unknown: "—" },
    utilColor,
  };

  it("returns utilisation bands with counts", () => {
    const out = buildLegend(lens(), people, legendCtx);
    expect(out.map((e) => e.label)).toEqual([
      "Unassigned",
      "Under 100%",
      "Over 100%",
      "Over 110%",
    ]);
    expect(out.find((e) => e.label === "Unassigned")?.count).toBe(1);
    expect(out.find((e) => e.label === "Under 100%")?.count).toBe(1);
    expect(out.find((e) => e.label === "Over 110%")?.count).toBe(1);
  });

  it("counts only the discipline values actually present, most-populous first", () => {
    const out = buildLegend(lens({ colorBy: "discipline" }), people, legendCtx);
    expect(out[0]).toMatchObject({ label: "Engineering", count: 2, color: "#0369a1" });
    expect(out[1]).toMatchObject({ label: "No discipline", count: 1 });
  });

  it("sorts the missing-value bucket last even when it is the biggest", () => {
    const mostlyUnknown = [
      person({ id: "x1", name: "X", employment: "unknown" }),
      person({ id: "x2", name: "Y", employment: "unknown" }),
      person({ id: "x3", name: "Z", employment: "fte" }),
    ];
    const out = buildLegend(lens({ colorBy: "employment" }), mostlyUnknown, legendCtx);
    expect(out.at(-1)?.label).toBe("—");
  });
});

// --- labels ----------------------------------------------------------------

describe("labels", () => {
  it("builds initials from first and last name only", () => {
    expect(initialsOf("Marco Webb")).toBe("MW");
    expect(initialsOf("Ada Lovelace King")).toBe("AK");
    expect(initialsOf("Prince")).toBe("P");
    expect(initialsOf("  ")).toBe("");
  });

  it("promotes the title only under name + title", () => {
    const p = { name: "Marco Webb", title: "Staff Engineer" };
    expect(personLabel(p, lens())).toEqual({ primary: "Marco Webb", secondary: null });
    expect(personLabel(p, lens({ labelBy: "nameTitle" }))).toEqual({
      primary: "Marco Webb",
      secondary: "Staff Engineer",
    });
    expect(personLabel(p, lens({ labelBy: "initials" }))).toEqual({
      primary: "MW",
      secondary: null,
    });
  });

  it("shortens the name for ghost seats but never the initials", () => {
    const p = { name: "Marco Webb", title: null };
    expect(personLabel(p, lens(), { short: true }).primary).toBe("M. Webb");
    expect(personLabel(p, lens({ labelBy: "initials" }), { short: true }).primary).toBe("MW");
  });

  it("treats a blank title as no title", () => {
    expect(personLabel({ name: "A B", title: "   " }, lens({ labelBy: "nameTitle" })).secondary).toBe(
      null,
    );
  });
});
