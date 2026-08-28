import { describe, it, expect } from "vitest";
import {
  computePodGaps,
  gapLabel,
  type PodTemplateRole,
} from "@/lib/analytics/podTemplate";
import type { Snapshot } from "@/lib/org/model";

function person(id: string, disciplineId: string | null) {
  return {
    id,
    name: id,
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

function team(id: string, name: string) {
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

function group(id: string, name: string) {
  return { ...team(id, name), kind: "group" as const } as unknown as Snapshot["units"][0];
}

function assignment(id: string, personId: string | null, orgUnitId: string, isOpenRole = false) {
  return {
    id,
    personId,
    orgUnitId,
    workspaceId: "ws1",
    allocationPct: 100,
    isOpenRole,
    roleOnTeam: null,
  } as unknown as Snapshot["assignments"][0];
}

const template: PodTemplateRole[] = [
  { disciplineId: "eng", minCount: 2, maxCount: 4 },
  { disciplineId: "qa", minCount: 1, maxCount: null }, // 1+
];

describe("computePodGaps", () => {
  it("reports no template when the template is empty", () => {
    const snap: Snapshot = { people: [], units: [team("t1", "T1")], assignments: [] };
    const r = computePodGaps(snap, []);
    expect(r.hasTemplate).toBe(false);
    expect(r.teams).toHaveLength(0);
  });

  it("marks a team complete when every role is in range", () => {
    const snap: Snapshot = {
      people: [person("p1", "eng"), person("p2", "eng"), person("p3", "qa")],
      units: [team("t1", "Earthlight")],
      assignments: [
        assignment("a1", "p1", "t1"),
        assignment("a2", "p2", "t1"),
        assignment("a3", "p3", "t1"),
      ],
    };
    const r = computePodGaps(snap, template);
    expect(r.teams[0].category).toBe("complete");
    expect(r.teams[0].worst).toBeNull();
    expect(r.summary.complete).toBe(1);
  });

  it("flags a missing required role (No QA)", () => {
    const snap: Snapshot = {
      people: [person("p1", "eng"), person("p2", "eng")],
      units: [team("t1", "Tideway")],
      assignments: [assignment("a1", "p1", "t1"), assignment("a2", "p2", "t1")],
    };
    const r = computePodGaps(snap, template);
    expect(r.teams[0].category).toBe("missing");
    expect(r.teams[0].worst?.disciplineId).toBe("qa");
    expect(gapLabel(r.teams[0].worst, "QA")).toBe("No QA");
    expect(r.summary.missing).toBe(1);
  });

  it("flags under strength (thin) when below min but present", () => {
    const snap: Snapshot = {
      people: [person("p1", "eng"), person("p2", "qa")],
      units: [team("t1", "Lighthouse")],
      assignments: [assignment("a1", "p1", "t1"), assignment("a2", "p2", "t1")],
    };
    // eng needs 2, has 1 → thin; qa ok.
    const r = computePodGaps(snap, template);
    expect(r.teams[0].category).toBe("under");
    expect(r.teams[0].worst?.disciplineId).toBe("eng");
    expect(gapLabel(r.teams[0].worst, "Engineering")).toBe("Thin on Engineering");
  });

  it("flags over strength past a max", () => {
    const snap: Snapshot = {
      people: ["e1", "e2", "e3", "e4", "e5"].map((id) => person(id, "eng")).concat(person("q", "qa")),
      units: [team("t1", "Heavy")],
      assignments: ["e1", "e2", "e3", "e4", "e5", "q"].map((id, i) =>
        assignment(`a${i}`, id, "t1"),
      ),
    };
    // eng max 4, has 5 → over.
    const r = computePodGaps(snap, template);
    expect(r.teams[0].category).toBe("over");
    expect(gapLabel(r.teams[0].worst, "Engineering")).toBe("Heavy on Engineering");
  });

  it("missing outranks under when a team has both", () => {
    const snap: Snapshot = {
      // eng has 1 (needs 2 → under); qa has 0 (needs 1 → missing). Missing wins.
      people: [person("p1", "eng")],
      units: [team("t1", "T")],
      assignments: [assignment("a1", "p1", "t1")],
    };
    const r = computePodGaps(snap, template);
    expect(r.teams[0].category).toBe("missing");
    expect(r.teams[0].worst?.disciplineId).toBe("qa");
  });

  it("ignores groups and open roles", () => {
    const snap: Snapshot = {
      people: [person("p1", "eng"), person("p2", "eng")],
      units: [group("g1", "Stream"), team("t1", "T")],
      assignments: [
        assignment("a1", "p1", "t1"),
        assignment("a2", "p2", "t1"),
        assignment("a3", null, "t1", true), // open QA seat — doesn't count as coverage
      ],
    };
    const r = computePodGaps(snap, template);
    expect(r.teams).toHaveLength(1); // group excluded
    expect(r.teams[0].category).toBe("missing"); // open role didn't fill QA
  });

  it("counts a shared person on each team they sit in", () => {
    const snap: Snapshot = {
      people: [person("p1", "qa")],
      units: [team("t1", "A"), team("t2", "B")],
      assignments: [assignment("a1", "p1", "t1"), assignment("a2", "p1", "t2")],
    };
    const r = computePodGaps(snap, [{ disciplineId: "qa", minCount: 1, maxCount: null }]);
    expect(r.teams.every((t) => t.category === "complete")).toBe(true);
  });
});
