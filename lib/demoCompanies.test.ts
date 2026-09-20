import { describe, expect, it } from "vitest";
import { DEMO_COMPANIES, isSampleWorkFixtureName } from "./demoCompanies";

describe("sample-work fixtures", () => {
  it("offers only the small invented company as a seedable demo", () => {
    expect(Object.keys(DEMO_COMPANIES)).toEqual(["small"]);
    expect(Object.values(DEMO_COMPANIES).some((company) =>
      company.name.includes("Northwind") || company.name.includes("Big Organization"),
    )).toBe(false);
  });

  it("limits invented work to named fixtures", () => {
    expect(isSampleWorkFixtureName("Digital Tailoring Supplies")).toBe(true);
    expect(isSampleWorkFixtureName("Sparrow Jam Manufacturing, OH")).toBe(true);
    expect(isSampleWorkFixtureName(DEMO_COMPANIES.small.name)).toBe(true);
    expect(isSampleWorkFixtureName("My Organization")).toBe(false);
  });
});
