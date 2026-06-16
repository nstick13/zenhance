import { describe, it, expect } from "vitest";
import {
  computeOverAllocFindings,
  computeCouplingFindings,
  computeAllFindings,
} from "@/lib/analytics/findings";
import type { Snapshot } from "@/lib/org/model";

// ---------------------------------------------------------------------------
// Minimal fixture factories
// ---------------------------------------------------------------------------

function person(id: string, name: string) {
  return {
    id,
    name,
    workspaceId: "ws1",
    title: null,
    skills: [],
    growthFocus: null,
    costPerMonth: null,
    startDate: null,
    lastVacationAt: null,
    leadOf: [],
  } as unknown as Snapshot["people"][0];
}

function unit(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    name,
    workspaceId: "ws1",
    kind: "team" as const,
    parentId,
    targetHeadcount: null,
    leadPersonId: null,
    isExternal: false,
    vendorName: null,
  } as unknown as Snapshot["units"][0];
}

function assignment(
  id: string,
  personId: string | null,
  orgUnitId: string,
  allocationPct = 100,
  isOpenRole = false,
) {
  return {
    id,
    personId,
    orgUnitId,
    workspaceId: "ws1",
    allocationPct,
    isOpenRole,
    roleOnTeam: null,
  } as unknown as Snapshot["assignments"][0];
}

// ---------------------------------------------------------------------------
// Over-allocation findings
// ---------------------------------------------------------------------------

describe("computeOverAllocFindings", () => {
  it("returns empty when nobody is over-allocated", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha")],
      assignments: [assignment("a1", "p1", "u1", 100)],
    };
    expect(computeOverAllocFindings(snapshot)).toHaveLength(0);
  });

  it("flags a person on two teams", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1", 50),
        assignment("a2", "p1", "u2", 50),
      ],
    };
    const findings = computeOverAllocFindings(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("overalloc-p1");
    expect(findings[0].involvedUnitIds).toEqual(expect.arrayContaining(["u1", "u2"]));
    expect(findings[0].stat).toBe("100%");
    expect(findings[0].spotlightType).toBe("hub");
  });

  it("flags a person over 100% on a single team", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha")],
      assignments: [assignment("a1", "p1", "u1", 120)],
    };
    const findings = computeOverAllocFindings(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].stat).toBe("120%");
  });

  it("sorts by totalPct descending", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta"), unit("u3", "Gamma")],
      assignments: [
        assignment("a1", "p1", "u1", 60),
        assignment("a2", "p1", "u2", 60), // 120%
        assignment("a3", "p2", "u2", 50),
        assignment("a4", "p2", "u3", 80), // 130%
      ],
    };
    const findings = computeOverAllocFindings(snapshot);
    expect(findings[0].involvedPersonIds[0]).toBe("p2"); // 130% first
    expect(findings[1].involvedPersonIds[0]).toBe("p1"); // 120% second
  });

  it("ignores open roles", () => {
    const snapshot: Snapshot = {
      people: [],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", null, "u1", 100, true),
        assignment("a2", null, "u2", 100, true),
      ],
    };
    expect(computeOverAllocFindings(snapshot)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Coupling findings
// ---------------------------------------------------------------------------

describe("computeCouplingFindings", () => {
  it("returns empty when no pair shares 2+ people", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1"),
        assignment("a2", "p2", "u2"),
      ],
    };
    expect(computeCouplingFindings(snapshot)).toHaveLength(0);
  });

  it("flags a pair sharing exactly 2 people", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob"), person("p3", "Carol")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1"),
        assignment("a2", "p2", "u1"),
        assignment("a3", "p1", "u2"),
        assignment("a4", "p2", "u2"),
        assignment("a5", "p3", "u2"),
      ],
    };
    const findings = computeCouplingFindings(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].involvedUnitIds).toEqual(expect.arrayContaining(["u1", "u2"]));
    expect(findings[0].involvedPersonIds).toHaveLength(2);
    expect(findings[0].stat).toBe("2");
    expect(findings[0].spotlightType).toBe("ribbon");
  });

  it("does not flag a pair sharing only 1 person", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1"),
        assignment("a2", "p2", "u1"),
        assignment("a3", "p1", "u2"), // only p1 shared
      ],
    };
    expect(computeCouplingFindings(snapshot)).toHaveLength(0);
  });

  it("sorts by shared-count descending", () => {
    const snapshot: Snapshot = {
      people: [
        person("p1", "Alice"),
        person("p2", "Bob"),
        person("p3", "Carol"),
      ],
      units: [unit("u1", "Alpha"), unit("u2", "Beta"), unit("u3", "Gamma")],
      assignments: [
        // u1 ↔ u2: share p1, p2, p3 (3 people)
        assignment("a1", "p1", "u1"),
        assignment("a2", "p2", "u1"),
        assignment("a3", "p3", "u1"),
        assignment("a4", "p1", "u2"),
        assignment("a5", "p2", "u2"),
        assignment("a6", "p3", "u2"),
        // u1 ↔ u3: share p1, p2 (2 people)
        assignment("a7", "p1", "u3"),
        assignment("a8", "p2", "u3"),
      ],
    };
    const findings = computeCouplingFindings(snapshot);
    expect(findings[0].involvedPersonIds).toHaveLength(3);
    expect(findings[1].involvedPersonIds).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// computeAllFindings
// ---------------------------------------------------------------------------

describe("computeAllFindings", () => {
  it("combines both finding types", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1", 50),
        assignment("a2", "p1", "u2", 80), // over-alloc (130%)
        assignment("a3", "p2", "u1"),
        assignment("a4", "p2", "u2"), // coupling (p2 on both, but only 1 shared with p1... wait)
      ],
    };
    // p1 is on both → over-alloc; p1+p2 both on u1+u2 → coupling (2 shared)
    const findings = computeAllFindings(snapshot);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain("over-allocation");
    expect(kinds).toContain("coupling");
  });
});
