import { describe, expect, it } from "vitest";
import { getSimilarPosts } from "./similarPosts";

describe("getSimilarPosts", () => {
  it("returns an empty list for missing search results", () => {
    expect(getSimilarPosts(undefined)).toEqual([]);
  });

  // Failure mode caught: the popup would render "looks similar to itself"
  // for the exact match it was reverse-searched from.
  it("excludes the exact match from the similar list", () => {
    const result = getSimilarPosts({
      exactPostId: 7,
      similarPosts: [
        { postId: 7, distance: 0 },
        { postId: 12, distance: 0.2 },
      ],
    });

    expect(result.map((x) => x.id)).toEqual([12]);
  });

  // Failure mode caught: flooring instead of rounding would report 87%.
  it("converts distance to a rounded similarity percentage", () => {
    const result = getSimilarPosts({
      similarPosts: [{ postId: 3, distance: 0.125 }],
    });

    expect(result).toHaveLength(1);
    expect(result[0].percentage).toBe(88); // Math.round(100 - 12.5)
  });
});
