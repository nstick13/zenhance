import { describe, it, expect } from "vitest";
import {
  normalizeEmployment,
  normalizeTimezone,
  isValidTimezone,
  suggestDiscipline,
  previewDisciplineSuggestions,
} from "../importMapping";

describe("normalizeEmployment", () => {
  it("maps the obvious spellings of each enum value", () => {
    expect(normalizeEmployment("FTE")).toBe("fte");
    expect(normalizeEmployment("Full-Time")).toBe("fte");
    expect(normalizeEmployment("Permanent")).toBe("fte");
    expect(normalizeEmployment("Contractor")).toBe("contractor");
    expect(normalizeEmployment("Contingent Worker")).toBe("contractor");
    expect(normalizeEmployment("Vendor")).toBe("vendor");
    expect(normalizeEmployment("Outsourced")).toBe("vendor");
  });

  it("is case- and separator-insensitive", () => {
    expect(normalizeEmployment("  full_time ")).toBe("fte");
    expect(normalizeEmployment("FULL TIME")).toBe("fte");
    expect(normalizeEmployment("3rd Party")).toBe("vendor");
  });

  it("reads decorated values by substring", () => {
    expect(normalizeEmployment("Contractor (Infosys)")).toBe("contractor");
    expect(normalizeEmployment("Full-Time Employee")).toBe("fte");
  });

  it("degrades to unknown rather than guessing", () => {
    expect(normalizeEmployment("")).toBe("unknown");
    expect(normalizeEmployment(undefined)).toBe("unknown");
    expect(normalizeEmployment("Band 7")).toBe("unknown");
    expect(normalizeEmployment("???")).toBe("unknown");
  });
});

describe("normalizeTimezone", () => {
  it("passes through valid IANA names", () => {
    expect(normalizeTimezone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(normalizeTimezone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(normalizeTimezone("UTC")).toBe("UTC");
  });

  it("repairs casing on IANA names", () => {
    expect(normalizeTimezone("europe/berlin")).toBe("Europe/Berlin");
    expect(normalizeTimezone("AMERICA/NEW_YORK")).toBe("America/New_York");
  });

  it("maps common abbreviations", () => {
    expect(normalizeTimezone("EST")).toBe("America/New_York");
    expect(normalizeTimezone("PST")).toBe("America/Los_Angeles");
    expect(normalizeTimezone("IST")).toBe("Asia/Kolkata");
    expect(normalizeTimezone("CET")).toBe("Europe/Berlin");
    expect(normalizeTimezone("gmt")).toBe("Europe/London");
  });

  it("maps whole-hour offsets, inverting the Etc/GMT sign convention", () => {
    // Etc/GMT-1 is UTC+1. Getting this backwards would mislabel all of Europe.
    expect(normalizeTimezone("GMT+1")).toBe("Etc/GMT-1");
    expect(normalizeTimezone("UTC-05:00")).toBe("Etc/GMT+5");
    expect(normalizeTimezone("+00:00")).toBe("UTC");
  });

  it("returns null rather than a wrong zone", () => {
    expect(normalizeTimezone("")).toBeNull();
    expect(normalizeTimezone(undefined)).toBeNull();
    expect(normalizeTimezone("Middle Earth/Shire")).toBeNull();
    expect(normalizeTimezone("+05:30")).toBeNull(); // half-hour: Etc/GMT can't say it
    expect(normalizeTimezone("GMT+20")).toBeNull();
  });

  it("agrees with the runtime about what is valid", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Nowhere/Nothing")).toBe(false);
  });
});

describe("suggestDiscipline", () => {
  it("reads the common engineering titles", () => {
    expect(suggestDiscipline("Senior Software Engineer")).toBe("Engineering");
    expect(suggestDiscipline("Backend Developer")).toBe("Engineering");
    expect(suggestDiscipline("Principal Architect")).toBe("Engineering");
  });

  it("puts specific disciplines above the general engineering rule", () => {
    expect(suggestDiscipline("QA Engineer")).toBe("QA");
    expect(suggestDiscipline("Security Engineer")).toBe("Security");
    expect(suggestDiscipline("Data Engineer")).toBe("Data");
    expect(suggestDiscipline("Platform Engineer")).toBe("Platform");
    expect(suggestDiscipline("SDET")).toBe("QA");
  });

  it("does not read every 'manager' as Management", () => {
    expect(suggestDiscipline("Product Manager")).toBe("Product");
    expect(suggestDiscipline("Delivery Manager")).toBe("Delivery");
    expect(suggestDiscipline("Project Manager")).toBe("Delivery");
    expect(suggestDiscipline("Engineering Manager")).toBe("Management");
  });

  it("covers the non-engineering rungs", () => {
    expect(suggestDiscipline("UX Designer")).toBe("Design");
    expect(suggestDiscipline("Scrum Master")).toBe("Delivery");
    expect(suggestDiscipline("Site Reliability Engineer")).toBe("Platform");
    expect(suggestDiscipline("Head of Engineering")).toBe("Management");
  });

  it("prefers a discipline the workspace already has over inventing one", () => {
    expect(suggestDiscipline("Senior Software Engineer", ["Software Engineering"])).toBe(
      "Software Engineering",
    );
    // Longest known name wins, so the more specific taxonomy entry survives.
    expect(
      suggestDiscipline("Data Engineering Lead", ["Engineering", "Data Engineering"]),
    ).toBe("Data Engineering");
  });

  it("reuses the workspace's own casing when the rule fires", () => {
    expect(suggestDiscipline("QA Analyst", ["qa"])).toBe("qa");
  });

  it("returns null rather than mislabelling", () => {
    expect(suggestDiscipline("")).toBeNull();
    expect(suggestDiscipline(undefined)).toBeNull();
    expect(suggestDiscipline("Band 7 Associate")).toBeNull();
  });
});

describe("previewDisciplineSuggestions", () => {
  it("counts what a suggestion pass would create, most populous first", () => {
    const p = previewDisciplineSuggestions(
      [
        "Software Engineer",
        "Senior Software Engineer",
        "Backend Developer",
        "QA Engineer",
        "Band 7 Associate",
        "",
      ],
      ["QA"],
    );
    expect(p.matched).toBe(4);
    expect(p.unmatched).toBe(2);
    expect(p.byDiscipline[0]).toEqual({ name: "Engineering", count: 3, isNew: true });
    expect(p.byDiscipline[1]).toEqual({ name: "QA", count: 1, isNew: false });
  });

  it("samples the misses so the miss rate is judgeable, without listing blanks", () => {
    const p = previewDisciplineSuggestions(["Band 7 Associate", "", null, "Grade 4"]);
    expect(p.unmatched).toBe(4);
    expect(p.sampleMisses).toEqual(["Band 7 Associate", "Grade 4"]);
  });
});
