import { describe, expect, it } from "vitest";
import { deprioritizeTags } from "../utils";

type TestTag = { name: string; category?: string };

const tag = (name: string, category?: string): TestTag => ({ name, category });

describe("deprioritizeTags", () => {
  it("should move tags with deprioritized categories to the end", () => {
    const tags = [tag("foo", "general"), tag("alice", "artist"), tag("bar", "character")];

    expect(deprioritizeTags(tags, ["artist"])).toEqual([
      tag("foo", "general"),
      tag("bar", "character"),
      tag("alice", "artist"),
    ]);
  });

  it("should preserve the relative order within each group", () => {
    const tags = [tag("b", "artist"), tag("a", "general"), tag("c", "artist"), tag("d", "general")];

    expect(deprioritizeTags(tags, ["artist"])).toEqual([
      tag("a", "general"),
      tag("d", "general"),
      tag("b", "artist"),
      tag("c", "artist"),
    ]);
  });

  it("should support multiple deprioritized categories", () => {
    const tags = [tag("a", "general"), tag("b", "meta"), tag("c", "artist")];

    expect(deprioritizeTags(tags, ["artist", "meta"])).toEqual([
      tag("a", "general"),
      tag("b", "meta"),
      tag("c", "artist"),
    ]);
  });

  it("should do nothing when the deprioritized list is empty", () => {
    const tags = [tag("a", "artist"), tag("b", "general")];
    expect(deprioritizeTags(tags, [])).toEqual(tags);
  });

  it("should leave categories not in the deprioritized list up front", () => {
    const tags = [tag("a", "artist"), tag("b", "character")];
    expect(deprioritizeTags(tags, ["meta"])).toEqual(tags);
  });

  it("should keep tags without a category up front", () => {
    const tags = [tag("a"), tag("b", "artist")];
    expect(deprioritizeTags(tags, ["artist"])).toEqual([tag("a"), tag("b", "artist")]);
  });

  it("should handle an empty input list", () => {
    expect(deprioritizeTags([], ["artist"])).toEqual([]);
  });

  it("should not mutate the input list", () => {
    const tags = [tag("a", "artist"), tag("b", "general")];
    deprioritizeTags(tags, ["artist"]);
    expect(tags).toEqual([tag("a", "artist"), tag("b", "general")]);
  });
});
