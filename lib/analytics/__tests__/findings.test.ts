import { describe, it, expect } from "vitest";
import {
  computeSpreadFindings,
  computeOverCommitmentFindings,
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
// Spread findings — count-based, %-free, fires at 2+ teams by default
// ---------------------------------------------------------------------------

describe("computeSpreadFindings", () => {
  it("returns empty when everyone is on a single team", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha")],
      assignments: [assignment("a1", "p1", "u1", 100)],
    };
    expect(computeSpreadFindings(snapshot)).toHaveLength(0);
  });

  it("flags a person on two teams at nominal load (the fact is the finding)", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1", 40),
        assignment("a2", "p1", "u2", 40), // 80% total — under 100
      ],
    };
    const findings = computeSpreadFindings(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("spread-p1");
    expect(findings[0].kind).toBe("spread");
    expect(findings[0].stat).toBe("2"); // team count, not a %
    expect(findings[0].stat).not.toContain("%");
    expect(findings[0].involvedUnitIds).toEqual(expect.arrayContaining(["u1", "u2"]));
    expect(findings[0].spotlightType).toBe("hub");
  });

  it("does NOT flag someone over 100% on a single team", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha")],
      assignments: [assignment("a1", "p1", "u1", 120)],
    };
    expect(computeSpreadFindings(snapshot)).toHaveLength(0);
  });

  it("honours a custom threshold", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1", 50),
        assignment("a2", "p1", "u2", 50),
      ],
    };
    expect(computeSpreadFindings(snapshot, 3)).toHaveLength(0); // 2 teams < 3
    expect(computeSpreadFindings(snapshot, 2)).toHaveLength(1);
  });

  it("sorts by team count descending", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta"), unit("u3", "Gamma")],
      assignments: [
        assignment("a1", "p1", "u1", 50),
        assignment("a2", "p1", "u2", 50), // p1 on 2 teams
        assignment("a3", "p2", "u1", 30),
        assignment("a4", "p2", "u2", 30),
        assignment("a5", "p2", "u3", 30), // p2 on 3 teams
      ],
    };
    const findings = computeSpreadFindings(snapshot);
    expect(findings[0].involvedPersonIds[0]).toBe("p2"); // 3 teams first
    expect(findings[1].involvedPersonIds[0]).toBe("p1"); // 2 teams second
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
    expect(computeSpreadFindings(snapshot)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Over-commitment findings — declared > 100%, keeps the %
// ---------------------------------------------------------------------------

describe("computeOverCommitmentFindings", () => {
  it("returns empty when nobody exceeds 100%", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1", 50),
        assignment("a2", "p1", "u2", 50), // exactly 100
      ],
    };
    expect(computeOverCommitmentFindings(snapshot)).toHaveLength(0);
  });

  it("flags someone over 100% on a single team, carrying the %", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice")],
      units: [unit("u1", "Alpha")],
      assignments: [assignment("a1", "p1", "u1", 120)],
    };
    const findings = computeOverCommitmentFindings(snapshot);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("overcommit-p1");
    expect(findings[0].kind).toBe("over-commitment");
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
    const findings = computeOverCommitmentFindings(snapshot);
    expect(findings[0].involvedPersonIds[0]).toBe("p2"); // 130% first
    expect(findings[1].involvedPersonIds[0]).toBe("p1"); // 120% second
  });

  it("a person on 4 teams at 120% fires under BOTH detectors", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Devraj")],
      units: [unit("u1", "U1"), unit("u2", "U2"), unit("u3", "U3"), unit("u4", "U4")],
      assignments: [
        assignment("a1", "p1", "u1", 30),
        assignment("a2", "p1", "u2", 30),
        assignment("a3", "p1", "u3", 30),
        assignment("a4", "p1", "u4", 30), // 120% across 4 teams
      ],
    };
    expect(computeSpreadFindings(snapshot)).toHaveLength(1);
    expect(computeOverCommitmentFindings(snapshot)).toHaveLength(1);
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
  it("combines all three finding types", () => {
    const snapshot: Snapshot = {
      people: [person("p1", "Alice"), person("p2", "Bob")],
      units: [unit("u1", "Alpha"), unit("u2", "Beta")],
      assignments: [
        assignment("a1", "p1", "u1", 50),
        assignment("a2", "p1", "u2", 80), // p1: 2 teams (spread) + 130% (over-commit)
        assignment("a3", "p2", "u1"),
        assignment("a4", "p2", "u2"), // p1+p2 both on u1+u2 → coupling (2 shared)
      ],
    };
    const kinds = computeAllFindings(snapshot).map((f) => f.kind);
    expect(kinds).toContain("spread");
    expect(kinds).toContain("over-commitment");
    expect(kinds).toContain("coupling");
  });
});
