import { describe, expect, it } from "vitest";
import { DEMO_COMPANIES, isRetiredScaleDemoWorkspace, isSampleWorkFixtureName } from "./demoCompanies";

describe("interactive demo selection", () => {
  it("retires both generations of the large fixture without hiding the small demos", () => {
    expect(isRetiredScaleDemoWorkspace("Northwind Freight & Logistics")).toBe(true);
    expect(isRetiredScaleDemoWorkspace(DEMO_COMPANIES.large.name)).toBe(true);
    expect(isRetiredScaleDemoWorkspace("Sparrow Jam Manufacturing, OH")).toBe(false);
    expect(isRetiredScaleDemoWorkspace("Digital Tailoring Supplies")).toBe(false);
  });
});

describe("sample-work fixtures", () => {
  it("limits invented work to named fixtures", () => {
    expect(isSampleWorkFixtureName("Digital Tailoring Supplies")).toBe(true);
    expect(isSampleWorkFixtureName("Sparrow Jam Manufacturing, OH")).toBe(true);
    expect(isSampleWorkFixtureName(DEMO_COMPANIES.small.name)).toBe(true);
    expect(isSampleWorkFixtureName("My Organization")).toBe(false);
  });
});
