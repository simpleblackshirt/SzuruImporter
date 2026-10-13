import { describe, expect, it, vi } from "vitest";
import type { MicroTag, Post } from "~/api/models";
import { TagDetails } from "~/models";
import type { ScrapedPostDetails } from "~/models";
import type { MergeChangesetOptions, MergeEdits } from "./mergeChangeset";
import { appendScrapedSource, mergeChangeset, scrapedMissingTags } from "./mergeChangeset";

// Dual-line rednote source format, mirroring the source-dedup oracle suite:
// line 1 the browsed href, line 2 the tokenless canonical explore url.
const rednoteNoteId = "6ac3c331000000000b004539";
const rednoteTokenedHref = `https://www.rednote.com/discovery/item/${rednoteNoteId}?xsec_token=CB0abc123%3D&xsec_source=pc_feed`;
const rednoteCanonical = `https://www.xiaohongshu.com/explore/${rednoteNoteId}`;
const rednoteDualLine = `${rednoteTokenedHref}\n${rednoteCanonical}`;

let postSeq = 0;

function makePost(overrides: Partial<Post> = {}): Post {
  postSeq++;
  return {
    id: postSeq,
    version: 3,
    thumbnailUrl: "",
    creationTime: new Date("2026-01-01"),
    safety: "safe",
    source: null,
    type: "image",
    mimeType: "image/png",
    checksum: "checksum",
    fileSize: 1000,
    canvasWidth: 100,
    canvasHeight: 100,
    contentUrl: "",
    flags: [],
    tags: [],
    relations: [],
    user: { name: "user", avatarUrl: "" },
    score: 0,
    ownScore: 0,
    ownFavorite: false,
    tagCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    noteCount: 0,
    relationCount: 0,
    featureCount: 0,
    favoritedBy: [],
    hasCustomThumbnail: false,
    notes: [],
    comments: [],
    ...overrides,
  };
}

function makeScraped(overrides: Partial<ScrapedPostDetails> = {}): ScrapedPostDetails {
  // Plain object instead of the class constructor: ScrapedPostDetails' field
  // initializer needs window.crypto.randomUUID, which the changeset never reads.
  return {
    source: "https://example.com/page",
    tags: [],
    rating: "safe",
    instanceSpecificData: {},
    ...overrides,
  } as unknown as ScrapedPostDetails;
}

function microTag(name: string): MicroTag {
  return { names: [name], category: "default", usages: 0 };
}

function tagDetails(name: string): TagDetails {
  return new TagDetails([name]);
}

function makeEdits(overrides: Partial<MergeEdits> = {}): MergeEdits {
  return { source: null, safety: "safe", tags: [], tagsToAdd: [], ...overrides };
}

function makeOptions(overrides: Partial<MergeChangesetOptions> = {}): MergeChangesetOptions {
  return {
    edited: makeEdits(),
    imageToKeep: "current",
    selectedSiteId: "site-1",
    ensureContentToken: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("appendScrapedSource", () => {
  it("should merge into a null source without a leading empty line", () => {
    // Guards the `?? undefined` bridge: Post.source is nullable, mergeSources is not.
    expect(appendScrapedSource(null, "https://example.com/a")).toBe("https://example.com/a");
  });

  it("should not append a form-variant of an existing source", () => {
    const out = appendScrapedSource(
      "https://www.pixiv.net/artworks/93964654",
      "https://www.pixiv.net/en/artworks/93964654",
    );
    expect(out).toBe("https://www.pixiv.net/artworks/93964654");
  });

  it("should append a genuinely distinct source", () => {
    expect(appendScrapedSource("https://example.com/a", "https://example.com/b")).toBe(
      "https://example.com/a\nhttps://example.com/b",
    );
  });

  it("should keep both lines of the dual-line rednote format when merging into a null source", () => {
    expect(appendScrapedSource(null, rednoteDualLine)).toBe(rednoteDualLine);
  });

  it("should collapse an identical dual-line rednote re-merge to the same two lines", () => {
    expect(appendScrapedSource(rednoteDualLine, rednoteDualLine)).toBe(rednoteDualLine);
  });
});

describe("scrapedMissingTags", () => {
  it("should return only scraped tags absent from the post tags", () => {
    const postTags = [microTag("present")];
    const scrapedTags = [tagDetails("present"), tagDetails("missing")];
    expect(scrapedMissingTags(postTags, scrapedTags).map((t) => t.name)).toEqual(["missing"]);
  });

  it("should treat a scraped name matching a non-primary alias of an existing tag as present", () => {
    // Existing tag names ["alias", "primary"] must match a scraped tag named "alias".
    const existing = { names: ["alias", "primary"], category: "default", usages: 0 } as MicroTag;
    expect(scrapedMissingTags([existing], [tagDetails("alias")])).toHaveLength(0);
    expect(scrapedMissingTags([existing], [tagDetails("primary")])).toHaveLength(0);
  });

  it("should preserve scraped tag order when returning missing tags", () => {
    const scrapedTags = [tagDetails("c"), tagDetails("a"), tagDetails("b")];
    expect(scrapedMissingTags([microTag("a")], scrapedTags).map((t) => t.name)).toEqual(["c", "b"]);
  });
});

describe("mergeChangeset", () => {
  it("should carry only the version and report no changes for identical state", async () => {
    const existing = makePost({ version: 7, source: "https://example.com/a", tags: [microTag("t1")] });
    const options = makeOptions({
      edited: makeEdits({ source: "https://example.com/a", tags: [microTag("t1")] }),
    });

    const { request, hasChanges } = await mergeChangeset(existing, makeScraped(), options);

    expect(request).toEqual({ version: 7 });
    expect(hasChanges).toBe(false);
    expect(options.ensureContentToken).not.toHaveBeenCalled();
  });

  it("should set request.source only when the source changed", async () => {
    const existing = makePost({ source: "https://example.com/a" });

    const unchanged = await mergeChangeset(
      existing,
      makeScraped(),
      makeOptions({
        edited: makeEdits({ source: "https://example.com/a" }),
      }),
    );
    expect(unchanged.request.source).toBeUndefined();

    const changed = await mergeChangeset(
      existing,
      makeScraped(),
      makeOptions({
        edited: makeEdits({ source: "https://example.com/a\nhttps://example.com/b" }),
      }),
    );
    expect(changed.request.source).toBe("https://example.com/a\nhttps://example.com/b");
    expect(changed.hasChanges).toBe(true);
  });

  it("should treat an empty-string source edit as no change", async () => {
    // Locks the truthiness quirk of the inline diff: `!req.source` counts "" and null as no change.
    const existing = makePost({ source: "https://example.com/a" });
    const { request, hasChanges } = await mergeChangeset(
      existing,
      makeScraped(),
      makeOptions({
        edited: makeEdits({ source: "" }),
      }),
    );
    expect(request.source).toBe("");
    expect(hasChanges).toBe(false);
  });

  it("should set request.tags to the combined name list when tags differ", async () => {
    const existing = makePost({ tags: [microTag("kept")] });
    const tagsToAdd = [tagDetails("added-1"), tagDetails("added-2")];

    const { request, hasChanges } = await mergeChangeset(
      existing,
      makeScraped(),
      makeOptions({
        edited: makeEdits({ tags: [microTag("kept")], tagsToAdd }),
      }),
    );

    expect(request.tags).toEqual(["kept", "added-1", "added-2"]);
    expect(hasChanges).toBe(true);
  });

  it("should omit request.tags when the combined list equals the existing names in order", async () => {
    // isEqual is order-sensitive: a reordered tag list is a change, a matching one is not.
    const existing = makePost({ tags: [microTag("a"), microTag("b")] });

    const same = await mergeChangeset(
      existing,
      makeScraped(),
      makeOptions({
        edited: makeEdits({ tags: [microTag("a"), microTag("b")] }),
      }),
    );
    expect(same.request.tags).toBeUndefined();
    expect(same.hasChanges).toBe(false);

    const reordered = await mergeChangeset(
      existing,
      makeScraped(),
      makeOptions({
        edited: makeEdits({ tags: [microTag("b"), microTag("a")] }),
      }),
    );
    expect(reordered.request.tags).toEqual(["b", "a"]);
    expect(reordered.hasChanges).toBe(true);
  });

  it("should set request.safety when the safety changed", async () => {
    const existing = makePost({ safety: "safe" });

    const unchanged = await mergeChangeset(
      existing,
      makeScraped({ rating: "safe" }),
      makeOptions({
        edited: makeEdits({ safety: "safe" }),
      }),
    );
    expect(unchanged.request.safety).toBeUndefined();

    const changed = await mergeChangeset(
      existing,
      makeScraped({ rating: "sketchy" }),
      makeOptions({
        edited: makeEdits({ safety: "sketchy" }),
      }),
    );
    expect(changed.request.safety).toBe("sketchy");
    expect(changed.hasChanges).toBe(true);
  });

  it("should await the injected uploader before reading the content token", async () => {
    // The uploader may be the one that SETS the token: reading it before awaiting yields undefined.
    const scraped = makeScraped({ instanceSpecificData: { "site-1": { contentToken: undefined } } });
    const options = makeOptions({
      imageToKeep: "new",
      ensureContentToken: vi.fn(async () => {
        scraped.instanceSpecificData["site-1"].contentToken = "token-1";
      }),
    });

    const { request, hasChanges } = await mergeChangeset(makePost(), scraped, options);

    expect(options.ensureContentToken).toHaveBeenCalledTimes(1);
    expect(request.contentToken).toBe("token-1");
    expect(hasChanges).toBe(true);
  });

  it("should read an already-present content token for imageToKeep 'new'", async () => {
    const scraped = makeScraped({ instanceSpecificData: { "site-1": { contentToken: "token-2" } } });

    const { request } = await mergeChangeset(makePost(), scraped, makeOptions({ imageToKeep: "new" }));

    expect(request.contentToken).toBe("token-2");
  });

  it("should not touch the content token when imageToKeep is 'current'", async () => {
    const options = makeOptions({ imageToKeep: "current" });

    const { request } = await mergeChangeset(makePost(), makeScraped(), options);

    expect(options.ensureContentToken).not.toHaveBeenCalled();
    expect(request.contentToken).toBeUndefined();
  });
});
