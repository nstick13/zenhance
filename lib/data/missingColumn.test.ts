/**
 * The seatbelt only works if it recognises the crash — see `missingColumn.ts`
 * for why this exists at all.
 */
import { describe, expect, it } from "vitest";
import { isMissingColumn, UNDEFINED_COLUMN } from "@/lib/data/missingColumn";

describe("recognising a column the database has not been told about", () => {
  it("reads Postgres's own code", () => {
    expect(isMissingColumn(Object.assign(new Error("column \"distance\" does not exist"), { code: UNDEFINED_COLUMN }))).toBe(true);
  });

  it("finds it through a driver's wrapper", () => {
    const inner = Object.assign(new Error("undefined column"), { code: UNDEFINED_COLUMN });
    expect(isMissingColumn(Object.assign(new Error("query failed"), { cause: inner }))).toBe(true);
  });

  it("lets every other failure through untouched", () => {
    // A connection that is down, a table that is missing, a constraint that
    // fired: none of those are survivable by dropping a column, and swallowing
    // them would be how a real outage becomes a silent one.
    expect(isMissingColumn(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(false);
    expect(isMissingColumn(new Error("connection refused"))).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn("42703")).toBe(false);
  });

  it("does not spin on an error that wraps itself", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isMissingColumn(loop)).toBe(false);
  });
});
