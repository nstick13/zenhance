import { describe, it, expect } from "vitest";
import {
  resolveFindingsPolicy,
  spreadThresholdFor,
  DEFAULT_FINDINGS_POLICY,
  type FindingsPolicyRow,
} from "@/lib/analytics/findingsPolicy";
import { computeAllFindings, SPREAD_TEAM_THRESHOLD } from "@/lib/analytics/findings";
import type { Snapshot } from "@/lib/org/model";

// --- fixtures ---------------------------------------------------------------

function person(id: string, name: string, disciplineId: string | null = null) {
  return {
    id,
    name,
    workspaceId: "ws1",
    title: null,
    disciplineId,
    skills: [],
    growthFocus: null,
    costPerMonth: null,
    startDate: null,
    lastVacationAt: null,
    leadOf: [],
  } as unknown as Snapshot["people"][0];
}

function unit(id: string, name: string) {
  return {
    id,
    name,
    workspaceId: "ws1",
    kind: "team" as const,
    parentId: null,
    targetHeadcount: null,
    leadPersonId: null,
    isExternal: false,
    vendorName: null,
  } as unknown as Snapshot["units"][0];
}

function assignment(id: string, personId: string, orgUnitId: string, allocationPct = 50) {
  return {
    id,
    personId,
    orgUnitId,
    workspaceId: "ws1",
    allocationPct,
    isOpenRole: false,
    roleOnTeam: null,
  } as unknown as Snapshot["assignments"][0];
}

const row = (over: Partial<FindingsPolicyRow>): FindingsPolicyRow => ({
  disciplineId: null,
  spreadThreshold: null,
  spreadEnabled: true,
  overCommitmentEnabled: true,
  couplingEnabled: true,
  ...over,
});

// --- resolveFindingsPolicy --------------------------------------------------

describe("resolveFindingsPolicy", () => {
  it("returns the defaults when there are no rows", () => {
    const p = resolveFindingsPolicy([]);
    expect(p.spreadEnabled).toBe(true);
    expect(p.overCommitmentEnabled).toBe(true);
    expect(p.couplingEnabled).toBe(true);
    expect(p.defaultSpreadThreshold).toBe(SPREAD_TEAM_THRESHOLD);
    expect(p.perDiscipline.size).toBe(0);
  });

  it("reads switches and default threshold from the workspace (null-discipline) row", () => {
    const p = resolveFindingsPolicy([
      row({ disciplineId: null, spreadThreshold: 3, couplingEnabled: false }),
    ]);
    expect(p.defaultSpreadThreshold).toBe(3);
    expect(p.couplingEnabled).toBe(false);
    expect(p.spreadEnabled).toBe(true);
  });

  it("collects per-discipline overrides, preserving null as 'no limit'", () => {
    const p = resolveFindingsPolicy([
      row({ disciplineId: null, spreadThreshold: 2 }),
      row({ disciplineId: "sec", spreadThreshold: null }), // no limit
      row({ disciplineId: "qa", spreadThreshold: 2 }), // flag at 2
    ]);
    expect(p.perDiscipline.get("sec")).toBeNull();
    expect(p.perDiscipline.get("qa")).toBe(2);
    expect(p.perDiscipline.has("eng")).toBe(false);
  });
});

// --- spreadThresholdFor -----------------------------------------------------

describe("spreadThresholdFor", () => {
  const policy = resolveFindingsPolicy([
    row({ disciplineId: null, spreadThreshold: 3 }),
    row({ disciplineId: "sec", spreadThreshold: null }),
    row({ disciplineId: "qa", spreadThreshold: 2 }),
  ]);

  it("falls to the workspace default when the discipline is unset", () => {
    expect(spreadThresholdFor(policy, "eng")).toBe(3);
    expect(spreadThresholdFor(policy, null)).toBe(3);
  });

  it("uses a discipline's own threshold", () => {
    expect(spreadThresholdFor(policy, "qa")).toBe(2);
  });

  it("returns null (no limit) for an exempted discipline", () => {
    expect(spreadThresholdFor(policy, "sec")).toBeNull();
  });
});

// --- computeAllFindings under a policy --------------------------------------

describe("computeAllFindings honours the policy", () => {
  // p1 (Security) and p2 (QA) each on 2 teams at 50% — spread facts, no over-commit.
  const snapshot: Snapshot = {
    people: [person("p1", "Devraj", "sec"), person("p2", "Yuki", "qa")],
    units: [unit("u1", "Alpha"), unit("u2", "Beta")],
    assignments: [
      assignment("a1", "p1", "u1"),
      assignment("a2", "p1", "u2"),
      assignment("a3", "p2", "u1"),
      assignment("a4", "p2", "u2"),
    ],
  };

  it("with the default policy, both fire as Spread at threshold 2", () => {
    const kinds = computeAllFindings(snapshot).map((f) => f.kind);
    expect(kinds.filter((k) => k === "spread")).toHaveLength(2);
  });

  it("exempting Security (no limit) drops only Devraj", () => {
    const policy = resolveFindingsPolicy([
      row({ disciplineId: null, spreadThreshold: 2 }),
      row({ disciplineId: "sec", spreadThreshold: null }),
    ]);
    const spread = computeAllFindings(snapshot, policy).filter((f) => f.kind === "spread");
    expect(spread).toHaveLength(1);
    expect(spread[0].involvedPersonIds[0]).toBe("p2"); // QA still flagged
  });

  it("raising the default to 3 drops both (each is on only 2 teams)", () => {
    const policy = resolveFindingsPolicy([row({ disciplineId: null, spreadThreshold: 3 })]);
    expect(computeAllFindings(snapshot, policy).filter((f) => f.kind === "spread")).toHaveLength(0);
  });

  it("switching Spread off raises no spread findings at all", () => {
    const policy = resolveFindingsPolicy([row({ disciplineId: null, spreadEnabled: false })]);
    expect(computeAllFindings(snapshot, policy).some((f) => f.kind === "spread")).toBe(false);
  });

  it("a discipline threshold overrides the (higher) default for that discipline only", () => {
    // default 3 would drop both; QA lowered to 2 brings Yuki back, Devraj stays out.
    const policy = resolveFindingsPolicy([
      row({ disciplineId: null, spreadThreshold: 3 }),
      row({ disciplineId: "qa", spreadThreshold: 2 }),
    ]);
    const spread = computeAllFindings(snapshot, policy).filter((f) => f.kind === "spread");
    expect(spread).toHaveLength(1);
    expect(spread[0].involvedPersonIds[0]).toBe("p2");
  });

  it("the default policy equals passing no policy", () => {
    expect(computeAllFindings(snapshot, DEFAULT_FINDINGS_POLICY)).toEqual(
      computeAllFindings(snapshot),
    );
  });
});
