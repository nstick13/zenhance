import { describe, expect, it } from "vitest";
import { DEMO_COMPANIES, isRetiredScaleDemoWorkspace } from "./demoCompanies";

describe("interactive demo selection", () => {
  it("retires both generations of the large fixture without hiding the small demos", () => {
    expect(isRetiredScaleDemoWorkspace("Northwind Freight & Logistics")).toBe(true);
    expect(isRetiredScaleDemoWorkspace(DEMO_COMPANIES.large.name)).toBe(true);
    expect(isRetiredScaleDemoWorkspace("Sparrow Jam Manufacturing, OH")).toBe(false);
    expect(isRetiredScaleDemoWorkspace("Digital Tailoring Supplies")).toBe(false);
  });
});
