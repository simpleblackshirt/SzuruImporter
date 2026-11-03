import { describe, expect, it } from "vitest";
import type { MicroTag, Tag, TagCategory } from "~/api/models";
import { TagDetails } from "~/models";
import { candidateTagNames, computeTagUpdates, withProfileUrl } from "./tagFixup";
import type { ScrapedTagInfo } from "./tagFixup";

function postTag(names: string[], category: string): MicroTag {
  return { names, category, usages: 0 };
}

function instanceTag(names: string[], category: string, version = 1, description?: string): Tag {
  return {
    names,
    category,
    version,
    description,
    usages: 0,
    creationTime: new Date(),
    suggestions: [],
    implications: [],
  } as unknown as Tag;
}

function category(name: string, isDefault = false): TagCategory {
  return { name, version: 1, color: "#ffffff", usages: 0, default: isDefault };
}

describe("candidateTagNames", () => {
  it("returns szuru tags matching scraped tags with a category or profile url", () => {
    const scraped = [
      new TagDetails(["plain"], undefined),
      new TagDetails(["artist_tag"], "artist"),
      new TagDetails(["meta_tag"], undefined, undefined, "https://x.com/meta"),
    ];
    const postTags = [postTag(["plain"], "default"), postTag(["artist_tag"], "default"), postTag(["meta_tag"], "default")];

    expect(candidateTagNames(scraped, postTags)).toEqual(["artist_tag", "meta_tag"]);
  });

  it("matches via any of the szuru tag's names (aliases)", () => {
    const scraped = [new TagDetails(["alias"], "artist")];
    const postTags = [postTag(["primary", "alias"], "default")];

    expect(candidateTagNames(scraped, postTags)).toEqual(["primary"]);
  });

  // Regression: in the background the scraped tags are plain objects -
  // runtime messaging strips prototype members, so TagDetails' `name` getter
  // is gone. Matching must use the `names` array (the old code matched on
  // `name`, found nothing, and the whole fixup silently no-oped).
  it("works with deserialized (getter-less) scraped tags", () => {
    const scraped: ScrapedTagInfo[] = [
      { names: ["artist_tag"], category: "artist", profileUrl: "https://x.com/artist" },
      { names: ["plain"] },
    ];
    const postTags = [postTag(["artist_tag"], "default"), postTag(["plain"], "default")];

    expect(candidateTagNames(scraped, postTags)).toEqual(["artist_tag"]);
  });
});

describe("withProfileUrl", () => {
  it("sets the url when the description is empty", () => {
    expect(withProfileUrl(undefined, "https://x.com/a")).toBe("https://x.com/a");
    expect(withProfileUrl("", "https://x.com/a")).toBe("https://x.com/a");
    expect(withProfileUrl("  ", "https://x.com/a")).toBe("https://x.com/a");
  });

  it("appends the url to an existing description on a new line", () => {
    expect(withProfileUrl("The artist.", "https://x.com/a")).toBe("The artist.\nhttps://x.com/a");
  });

  it("keeps a description that already has the url as a whole line", () => {
    expect(withProfileUrl("The artist.\nhttps://x.com/a", "https://x.com/a")).toBeUndefined();
    // Trailing whitespace on the line does not defeat the match.
    expect(withProfileUrl("https://x.com/a  ", "https://x.com/a")).toBeUndefined();
    expect(withProfileUrl("a\r\nhttps://x.com/a\r\nb", "https://x.com/a")).toBeUndefined();
  });

  it("still appends when the url only appears inside another line", () => {
    expect(withProfileUrl("see https://x.com/a for more", "https://x.com/a")).toBe(
      "see https://x.com/a for more\nhttps://x.com/a",
    );
  });
});

describe("computeTagUpdates", () => {
  // A scraped artist tag carrying both a category and a profile url.
  const artist = scrapedTagWith("artist_tag", "artist", "https://x.com/artist");
  // A scraped tag whose category is the only scraped extra.
  const categorizedOnly = scrapedTagWith("artist_tag", "artist");

  function scrapedTagWith(name: string, category?: string, profileUrl?: string) {
    return new TagDetails([name], category, undefined, profileUrl);
  }

  it("re-categorizes default-category tags on an instance that renamed the default", () => {
    // Failure mode caught: the default category was hardcoded as "default",
    // so instances naming it e.g. "general" never got scraped categories.
    const instanceTags = [instanceTag(["artist_tag"], "general")];
    const categories = [category("general", true), category("artist")];

    const updates = computeTagUpdates(instanceTags, [categorizedOnly], categories);

    expect(updates).toEqual([{ name: "artist_tag", version: 1, category: "artist" }]);
  });

  it("re-categorizes default-category tags when the default is named 'default'", () => {
    const instanceTags = [instanceTag(["artist_tag"], "default")];
    const categories = [category("default", true), category("artist")];

    expect(computeTagUpdates(instanceTags, [categorizedOnly], categories)).toEqual([
      { name: "artist_tag", version: 1, category: "artist" },
    ]);
  });

  it("never touches tags already moved out of the default category", () => {
    const categories = [category("general", true), category("artist"), category("character")];
    const instanceTags = [
      instanceTag(["artist_tag"], "artist"),
      instanceTag(["other_tag"], "character"),
    ];

    expect(computeTagUpdates(instanceTags, [categorizedOnly, scrapedTagWith("other_tag", "artist")], categories)).toEqual([]);
  });

  it("skips categories the instance does not have", () => {
    const instanceTags = [instanceTag(["artist_tag"], "general")];
    const categories = [category("general", true)];

    expect(computeTagUpdates(instanceTags, [categorizedOnly], categories)).toEqual([]);
  });

  it("merges profile urls into the description regardless of category state", () => {
    const categories = [category("general", true), category("artist")];
    const instanceTags = [
      // New tag, still in default: category + description in one update.
      instanceTag(["artist_tag"], "general"),
      // Existing artist tag without a description: description-only update.
      instanceTag(["known_artist"], "artist", 3),
    ];
    const scraped = [
      artist,
      scrapedTagWith("known_artist", "artist", "https://x.com/known"),
    ];

    const updates = computeTagUpdates(instanceTags, scraped, categories);

    expect(updates).toEqual([
      { name: "artist_tag", version: 1, category: "artist", description: "https://x.com/artist" },
      { name: "known_artist", version: 3, description: "https://x.com/known" },
    ]);
  });

  it("emits nothing when neither category nor description change", () => {
    const categories = [category("general", true), category("artist")];
    const instanceTags = [instanceTag(["artist_tag"], "artist", 5, "bio\nhttps://x.com/artist")];

    expect(computeTagUpdates(instanceTags, [artist], categories)).toEqual([]);
  });

  it("ignores tags the post was not scraped with (e.g. implied tags)", () => {
    const categories = [category("general", true), category("artist")];
    const instanceTags = [instanceTag(["implied_tag"], "general")];

    expect(computeTagUpdates(instanceTags, [artist], categories)).toEqual([]);
  });

  it("matches scraped tags via any of the szuru tag's names", () => {
    const categories = [category("general", true), category("artist")];
    const instanceTags = [instanceTag(["primary", "artist_tag"], "general")];

    expect(computeTagUpdates(instanceTags, [categorizedOnly], categories)).toEqual([
      { name: "primary", version: 1, category: "artist" },
    ]);
  });

  // Regression companion to the candidateTagNames deserialization case: the
  // merge flow passes deserialized scraped tags through the same helper.
  it("works with deserialized (getter-less) scraped tags", () => {
    const categories = [category("general", true), category("artist")];
    const instanceTags = [instanceTag(["artist_tag"], "general", 2, "bio")];
    const scraped: ScrapedTagInfo[] = [
      { names: ["artist_tag"], category: "artist", profileUrl: "https://x.com/artist" },
    ];

    expect(computeTagUpdates(instanceTags, scraped, categories)).toEqual([
      { name: "artist_tag", version: 2, category: "artist", description: "bio\nhttps://x.com/artist" },
    ]);
  });
});
