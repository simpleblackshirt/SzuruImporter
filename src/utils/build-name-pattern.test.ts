import { describe, expect, it } from "vitest";
import { buildNamePattern } from "../utils";

describe("buildNamePattern", () => {
  it("should search short inputs as a prefix", () => {
    expect(buildNamePattern("a")).toBe("a*");
    expect(buildNamePattern("ha")).toBe("ha*");
  });

  it("should search longer inputs as a substring", () => {
    expect(buildNamePattern("hair")).toBe("*hair*");
  });

  it("should normalize whitespace before building the pattern", () => {
    expect(buildNamePattern("long hair")).toBe("*long_hair*");
    expect(buildNamePattern("  re zero  ")).toBe("*re_zero*");
  });

  it("should pass through explicitly typed wildcards verbatim", () => {
    expect(buildNamePattern("*hair*")).toBe("*hair*");
    expect(buildNamePattern("*hair")).toBe("*hair");
    expect(buildNamePattern("lo*hair")).toBe("lo*hair");
    expect(buildNamePattern("ha*")).toBe("ha*");
  });

  it("should return null for inputs containing nothing but wildcards", () => {
    expect(buildNamePattern("*")).toBe(null);
    expect(buildNamePattern("**")).toBe(null);
  });

  it("should return null for empty and whitespace-only input", () => {
    expect(buildNamePattern("")).toBe(null);
    expect(buildNamePattern("   ")).toBe(null);
  });
});
