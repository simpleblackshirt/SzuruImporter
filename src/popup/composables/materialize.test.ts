import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapeResult, ScrapeResults, ScrapedPost, ScrapedTag } from "neo-scraper";

const testCtx = vi.hoisted(() => ({
  browserStub: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment. ~/stores (cfg) touches storage.local
// at import time via useStorageLocal.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

import { cfg } from "~/stores";
import { FALLBACK_UPLOAD_AS_URL_NAME, materializeScrapeResults } from "./materialize";

function makePost(overrides: Partial<ScrapedPost> = {}): ScrapedPost {
  return Object.assign(new ScrapedPost(), overrides);
}

function makeResults(...results: ScrapeResult[]) {
  const scrapeResults = new ScrapeResults();
  scrapeResults.results.push(...results);
  return scrapeResults;
}

const defaultCfg = JSON.parse(JSON.stringify(cfg.value));

beforeEach(() => {
  cfg.value = JSON.parse(JSON.stringify(defaultCfg));
});

afterEach(() => {
  cfg.value = JSON.parse(JSON.stringify(defaultCfg));
});

describe("materializeScrapeResults", () => {
  it("prefixes post names with the engine and numbers unnamed posts", () => {
    const named = makePost({ name: "Some artwork" });
    const unnamed = makePost({ contentUrl: "https://cdn.example.com/b.jpg" });
    const results = makeResults(
      Object.assign(new ScrapeResult("twitter"), { posts: [named, unnamed] }),
    );

    const posts = materializeScrapeResults(results);

    // Unnamed posts are numbered by their position within the engine result.
    expect(posts.map((p) => p.name)).toEqual(["[twitter] Some artwork", "[twitter] Post 2"]);
  });

  it("clears parsed tags when addAllParsedTags is off", () => {
    const post = makePost({ tags: [new ScrapedTag("some_artist", "artist"), new ScrapedTag("original")] });
    cfg.value.addAllParsedTags = false;

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(vm.tags).toHaveLength(0);
  });

  it("keeps parsed tags by default", () => {
    const post = makePost({ tags: [new ScrapedTag("some_artist", "artist")] });

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(vm.tags.map((t) => t.name)).toEqual(["some_artist"]);
  });

  it("forces uploadMode content when alwaysUploadAsContent is on, except the fallback url post", () => {
    const normal = makePost({ uploadMode: "url" });
    const fallback = makePost({ name: "Upload as URL", uploadMode: "url", contentUrl: "https://example.com/page" });
    cfg.value.alwaysUploadAsContent = true;

    const posts = materializeScrapeResults(
      makeResults(
        Object.assign(new ScrapeResult("twitter"), { posts: [normal] }),
        Object.assign(new ScrapeResult("fallback"), { posts: [fallback] }),
      ),
    );

    expect(posts[0].name).not.toBe(FALLBACK_UPLOAD_AS_URL_NAME);
    expect(posts[0].uploadMode).toBe("content");
    expect(posts[1].name).toBe(FALLBACK_UPLOAD_AS_URL_NAME);
    expect(posts[1].uploadMode).toBe("url");
  });

  it("appends the page url to the source when it is not the same post", () => {
    const post = makePost({
      sources: ["https://x.com/someone/status/123"],
      pageUrl: "https://x.com/someone/status/456",
    });

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(vm.source).toBe("https://x.com/someone/status/123\nhttps://x.com/someone/status/456");
  });

  it("does not duplicate the source when the page url refers to the same post", () => {
    const post = makePost({
      sources: ["https://x.com/someone/status/123"],
      pageUrl: "https://x.com/someone/status/123?ref=timeline",
    });

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(vm.source).toBe("https://x.com/someone/status/123");
  });

  it("leaves the source alone when addPageUrlToSource is off", () => {
    const post = makePost({
      sources: ["https://x.com/someone/status/123"],
      pageUrl: "https://x.com/someone/status/123?ref=timeline",
    });
    cfg.value.addPageUrlToSource = false;

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(vm.source).toBe("https://x.com/someone/status/123");
  });

  it("removes ignored tags", () => {
    const post = makePost({ tags: [new ScrapedTag("kept_tag"), new ScrapedTag("ignored_tag")] });
    cfg.value.tagIgnores = [{ names: ["ignored_tag"] }] as any;

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(vm.tags.map((t) => t.name)).toEqual(["kept_tag"]);
  });

  it("initializes instanceSpecificData for every configured site", () => {
    cfg.value.sites = [{ id: "site-a" }, { id: "site-b" }] as any;
    const post = makePost();

    const [vm] = materializeScrapeResults(makeResults(Object.assign(new ScrapeResult("twitter"), { posts: [post] })));

    expect(Object.keys(vm.instanceSpecificData).sort()).toEqual(["site-a", "site-b"]);
    expect(vm.instanceSpecificData["site-a"]).toEqual({});
  });
});
