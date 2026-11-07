import { describe, expect, it } from "vitest";
import { normalizeName } from "../utils";

describe("normalizeName", () => {
  it("should replace an internal space with an underscore", () => {
    expect(normalizeName("long hair")).toBe("long_hair");
  });

  it("should collapse consecutive internal spaces into a single underscore", () => {
    expect(normalizeName("long   hair")).toBe("long_hair");
  });

  it("should trim leading and trailing spaces", () => {
    expect(normalizeName("  hair ornament  ")).toBe("hair_ornament");
  });

  it("should replace other whitespace characters like tabs and non-breaking spaces", () => {
    expect(normalizeName("long\thair")).toBe("long_hair");
    expect(normalizeName("long\u00a0hair")).toBe("long_hair");
  });

  it("should combine trimming and internal replacement", () => {
    expect(normalizeName("  spaced   out  ")).toBe("spaced_out");
  });

  it("should leave already clean names unchanged", () => {
    expect(normalizeName("already_clean")).toBe("already_clean");
    expect(normalizeName("re:zero")).toBe("re:zero");
  });

  it("should reduce whitespace-only input to an empty name", () => {
    // PopupMain rejects names with length 0, so nothing gets added.
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName("")).toBe("");
  });
});
