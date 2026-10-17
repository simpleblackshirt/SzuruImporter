import { describe, expect, it } from "vitest";
import type { Tag } from "~/api/models";
import { TagDetails } from "~/models";
import { applyInstanceTagData } from "./applyInstanceTagData";

function instanceTag(names: string[], category: string, usages: number): Tag {
  return { names, category, usages } as unknown as Tag;
}

describe("applyInstanceTagData", () => {
  it("copies the usage count from the matching instance tag", () => {
    const scraped = new TagDetails(["tag"]);

    const result = applyInstanceTagData([scraped], [instanceTag(["tag"], "character", 42)], false);

    expect(result[0].usages).toBe(42);
  });

  it("fills in the instance category on a scraped tag without one", () => {
    // Failure mode caught: backend-known tags staying uncolored in the popup
    // because only the usage count was copied from the instance.
    const scraped = new TagDetails(["tag"]);

    const result = applyInstanceTagData([scraped], [instanceTag(["tag"], "character", 1)], false);

    expect(result[0].category).toBe("character");
  });

  it("keeps a category scraped from the source site", () => {
    // Failure mode caught: the instance overwriting a category the scraper
    // did provide (the upload flow treats scraped categories as meaningful).
    const scraped = new TagDetails(["tag"], "artist");

    const result = applyInstanceTagData([scraped], [instanceTag(["tag"], "character", 1)], false);

    expect(result[0].category).toBe("artist");
  });

  it("leaves tags unknown to the instance untouched", () => {
    const a = new TagDetails(["unknown-a"]);
    const b = new TagDetails(["unknown-b"], "copyright");

    const result = applyInstanceTagData([a, b], [instanceTag(["tag"], "character", 1)], false);

    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
    expect(result[0].usages).toBeUndefined();
    expect(result[0].category).toBeUndefined();
  });

  it("fills usages and category on an alias resolved to its primary name", () => {
    // Failure mode caught: the resolved tag matching by its new primary name
    // (the instance tag lists it in names[]) but not getting enriched.
    const scraped = new TagDetails(["alias"]);

    const result = applyInstanceTagData([scraped], [instanceTag(["primary", "alias"], "character", 7)], true);

    expect(result.map((t) => t.name)).toEqual(["primary"]);
    expect(result[0].usages).toBe(7);
    expect(result[0].category).toBe("character");
  });

  it("keeps a scraped category when resolving an alias", () => {
    const scraped = new TagDetails(["alias"], "artist");

    const result = applyInstanceTagData([scraped], [instanceTag(["primary", "alias"], "character", 7)], true);

    expect(result[0].name).toBe("primary");
    expect(result[0].category).toBe("artist");
  });

  it("does not resolve aliases when asked not to", () => {
    // Failure mode caught: alias resolution running even though the option is
    // off, renaming tags the user wanted left as scraped.
    const scraped = new TagDetails(["alias"]);

    const result = applyInstanceTagData([scraped], [instanceTag(["primary", "alias"], "character", 7)], false);

    expect(result[0]).toBe(scraped);
    expect(result[0].name).toBe("alias");
  });

  it("keeps the input array when nothing needs rewriting", () => {
    // Failure mode caught: needless re-allocation breaking object identity
    // the popup may hold on to.
    const a = new TagDetails(["a"]);
    const tags = [a];

    const result = applyInstanceTagData(tags, [], false);

    expect(result).toEqual([a]);
    expect(result).toBe(tags);
    expect(result[0]).toBe(a);
  });
});
