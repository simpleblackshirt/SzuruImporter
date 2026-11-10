import { describe, expect, it, vi } from "vitest";
import { TagDetails } from "~/models";
import { countNewTagNames, createStagedTags, fetchExistingTagNames } from "./stagedTagCreation";

/**
 * Save-time tag bookkeeping: the accurate "created tags" count (pre-save
 * existence check over ALL post tags, not just staged ones), race adoption
 * via the shared existence set, permission degradation, and the in-place
 * clearing of settled staged entries so the plain name rides the post
 * payload and applyTagFixup never attempts a category edit the user cannot
 * perform.
 */

const makeSzuru = (overrides: { getTags?: any; createTag?: any } = {}) => ({
  getTags: overrides.getTags ?? vi.fn().mockResolvedValue({ results: [] }),
  createTag: overrides.createTag ?? vi.fn().mockResolvedValue({}),
});

const stagedTag = (name: string, category: string, implications: string[] = []) => {
  const tag = new TagDetails([name], category);
  tag.staged = { implications };
  return tag;
};

/**
 * What a staged TagDetails looks like after crossing the messaging boundary:
 * prototype members (the `name` getter) are stripped, plain fields remain.
 * Regression guard for the "no getters after deserializing" trap.
 */
const strippedStagedTag = (name: string, category: string, implications: string[] = []) =>
  ({ names: [name], category, staged: { implications } }) as any as TagDetails;

describe("fetchExistingTagNames", () => {
  it("collects every name of matched tags, including aliases", async () => {
    const szuru = makeSzuru({
      getTags: vi.fn().mockResolvedValue({
        results: [
          { names: ["primary", "alias"] },
          { names: ["other"] },
        ],
      }),
    });

    const existing = await fetchExistingTagNames(szuru as any, ["primary", "other"]);

    expect(existing).toEqual(new Set(["primary", "alias", "other"]));
  });

  it("queries batched, encoded, name-list searches with names-only fields", async () => {
    const getTags = vi.fn().mockResolvedValue({ results: [] });
    const szuru = makeSzuru({ getTags });

    await fetchExistingTagNames(szuru as any, ["tag:one", "tag two"]);

    expect(getTags).toHaveBeenCalledTimes(1);
    const [query, offset, limit, fields] = getTags.mock.calls[0];
    expect(query).toBe("tag\\:one,tag two");
    expect(offset).toBe(0);
    expect(limit).toBe(100);
    expect(fields).toEqual(["names"]);
  });

  it("splits large name lists into batches of 100", async () => {
    const getTags = vi.fn().mockResolvedValue({ results: [] });
    const szuru = makeSzuru({ getTags });
    const names = Array.from({ length: 150 }, (_, i) => `tag_${i}`);

    await fetchExistingTagNames(szuru as any, names);

    expect(getTags).toHaveBeenCalledTimes(2);
    expect(getTags.mock.calls[0][0].split(",")).toHaveLength(100);
    expect(getTags.mock.calls[1][0].split(",")).toHaveLength(50);
  });

  it("dedupes input names before querying", async () => {
    const getTags = vi.fn().mockResolvedValue({ results: [] });
    const szuru = makeSzuru({ getTags });

    await fetchExistingTagNames(szuru as any, ["a", "a", "b"]);

    expect(getTags.mock.calls[0][0]).toBe("a,b");
  });

  it("skips the query entirely for an empty name list", async () => {
    const getTags = vi.fn();
    const szuru = makeSzuru({ getTags });

    const existing = await fetchExistingTagNames(szuru as any, []);

    expect(existing.size).toBe(0);
    expect(getTags).not.toHaveBeenCalled();
  });
});

describe("countNewTagNames", () => {
  it("counts names absent from the existing set, deduped", () => {
    expect(countNewTagNames(["a", "b", "a"], new Set(["b"]))).toBe(1);
  });

  it("counts everything when nothing exists", () => {
    expect(countNewTagNames(["a", "b"], new Set())).toBe(2);
  });

  it("counts nothing when everything exists", () => {
    expect(countNewTagNames(["a", "b"], new Set(["a", "b"]))).toBe(0);
  });

  it("ignores empty names", () => {
    expect(countNewTagNames(["", "a"], new Set(["a"]))).toBe(0);
  });
});

describe("createStagedTags", () => {
  it("creates nothing when no tag is staged", async () => {
    const szuru = makeSzuru();
    const result = await createStagedTags(szuru as any, [new TagDetails(["known"], "artist", 2)], new Set());
    expect(result).toEqual({ created: 0, degraded: 0, warning: undefined });
    expect(szuru.createTag).not.toHaveBeenCalled();
    expect(szuru.getTags).not.toHaveBeenCalled();
  });

  it("creates each staged tag with its intended category and implications", async () => {
    const szuru = makeSzuru();
    const hair = stagedTag("hair", "meta");
    const longHair = stagedTag("long_hair", "character", ["hair"]);

    const result = await createStagedTags(szuru as any, [longHair, hair], new Set());

    expect(result.created).toBe(2);
    expect(result.degraded).toBe(0);
    // Implication target created before the tag implying it.
    expect(szuru.createTag.mock.calls.map((x) => x[0][0])).toEqual(["hair", "long_hair"]);
    expect(szuru.createTag).toHaveBeenLastCalledWith(["long_hair"], {
      names: ["long_hair"],
      category: "character",
      implications: ["hair"],
    });
  });

  it("clears the staged marker after settling", async () => {
    const szuru = makeSzuru();
    const tag = stagedTag("new_tag", "artist", []);

    await createStagedTags(szuru as any, [tag], new Set());

    expect(tag.staged).toBeUndefined();
  });

  it("adopts a staged tag that the pre-check found on the instance (race)", async () => {
    const szuru = makeSzuru();
    const tag = stagedTag("new_tag", "artist");

    const result = await createStagedTags(szuru as any, [tag], new Set(["new_tag"]));

    expect(result.created).toBe(0);
    expect(result.degraded).toBe(0);
    expect(szuru.createTag).not.toHaveBeenCalled();
    expect(tag.staged).toBeUndefined();
  });

  it("adopts on TagAlreadyExistsError", async () => {
    const szuru = makeSzuru({
      createTag: vi.fn().mockRejectedValue({ name: "TagAlreadyExistsError", description: "exists" }),
    });
    const tag = stagedTag("new_tag", "artist");

    const result = await createStagedTags(szuru as any, [tag], new Set());

    expect(result.created).toBe(0);
    expect(result.degraded).toBe(0);
    expect(tag.staged).toBeUndefined();
  });

  it("degrades on InsufficientPrivilegeError and reports a warning", async () => {
    const szuru = makeSzuru({
      createTag: vi.fn().mockRejectedValue({ name: "InsufficientPrivilegeError", description: "not allowed" }),
    });
    const tag = stagedTag("new_tag", "artist");

    const result = await createStagedTags(szuru as any, [tag], new Set());

    expect(result.created).toBe(0);
    expect(result.degraded).toBe(1);
    expect(result.warning).toContain("new_tag");
    // Degradation strips the marker AND the category, so the plain name rides
    // the post payload and applyTagFixup won't try to fix the category.
    expect(tag.staged).toBeUndefined();
    expect(tag.category).toBeUndefined();
  });

  it("degrades on unexpected failures instead of failing the upload", async () => {
    const szuru = makeSzuru({ createTag: vi.fn().mockRejectedValue(new Error("network down")) });
    const tag = stagedTag("new_tag", "artist");

    const result = await createStagedTags(szuru as any, [tag], new Set());

    expect(result.degraded).toBe(1);
    expect(tag.staged).toBeUndefined();
    expect(tag.category).toBeUndefined();
  });

  it("still creates a tag whose implication target degraded, without the lost edge", async () => {
    const createTag = vi
      .fn()
      .mockRejectedValueOnce({ name: "InsufficientPrivilegeError" })
      .mockResolvedValueOnce({});
    const szuru = makeSzuru({ createTag });
    const target = stagedTag("target", "meta");
    const source = stagedTag("source", "character", ["target"]);

    const result = await createStagedTags(szuru as any, [source, target], new Set());

    expect(result.degraded).toBe(1);
    expect(result.created).toBe(1);
    // The source tag itself is still wanted; only its implication edge into
    // the degraded target is dropped (the backend would silently lose it).
    expect(createTag).toHaveBeenCalledTimes(2);
    expect(createTag).toHaveBeenLastCalledWith(["source"], {
      names: ["source"],
      category: "character",
      implications: [],
    });
    expect(target.staged).toBeUndefined();
    expect(source.staged).toBeUndefined();
  });

  it("keeps creating later staged tags when one degrades", async () => {
    const createTag = vi
      .fn()
      .mockRejectedValueOnce({ name: "InsufficientPrivilegeError" })
      .mockResolvedValueOnce({});
    const szuru = makeSzuru({ createTag });
    const degraded = stagedTag("bad", "artist");
    const fine = stagedTag("good", "character");

    const result = await createStagedTags(szuru as any, [degraded, fine], new Set());

    expect(result.created).toBe(1);
    expect(result.degraded).toBe(1);
    expect(fine.staged).toBeUndefined();
  });

  it("dedupes carried entries with the same name", async () => {
    const szuru = makeSzuru();
    const first = stagedTag("dup", "artist");
    const second = stagedTag("dup", "artist");

    const result = await createStagedTags(szuru as any, [first, second], new Set());

    expect(result.created).toBe(1);
    expect(szuru.createTag).toHaveBeenCalledTimes(1);
  });

  it("works on messaging-stripped TagDetails (no prototype getters)", async () => {
    const szuru = makeSzuru();
    const hair = strippedStagedTag("hair", "meta");
    const longHair = strippedStagedTag("long_hair", "character", ["hair"]);

    const result = await createStagedTags(szuru as any, [longHair, hair], new Set());

    expect(result.created).toBe(2);
    expect(szuru.createTag.mock.calls.map((x) => x[0][0])).toEqual(["hair", "long_hair"]);
    expect(hair.staged).toBeUndefined();
    expect(longHair.staged).toBeUndefined();
  });
});
