import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScrapeResults } from "neo-scraper";
import { bigimgsrcUrlsFromHtml, fetchLofterPermalinkHtml, upgradeLofterPosts } from "./lofterUpgrade";

// Live urls (user-report grab): the timeline card resolves the feed rendition
// while the permalink page's bigimgsrc carries the large rendition - a
// different stored object with a different content-type and a ~136 byte
// metadata delta. These are the two shapes this pass unifies.
const feedA = "https://imglf5.lf127.net/img/846a7b64800067cb/YTBpaWdJRnlBOXJYNXlGMGp6amVoSXNlZlBuVlBQbWMzam4yY3hxT3Flaz0.jpg";
const largeA = "https://imglf3.lf127.net/img/97ef65b09ccda5c0/YTBpaWdJRnlBOXJYNXlGMGp6amVoR3d5RDFTUk5zRXFRZ1VTd2p4WHRlTT0.jpg";
const feedB = "https://imglf3.lf127.net/img/ee49a5accead524c/YTBpaWdJRnlBOXJYNXlGMGp6amVoSWtZdFRxRG1wVXJJQlowUTkvVjU4Yz0.jpg";
const largeB = "https://imglf4.lf127.net/img/7e2e1fe0f0bd4776/YTBpaWdJRnlBOXJYNXlGMGp6amVoRFF3aFNkdjVseHNySjRKdWFXNnBCND0.jpg";

const PERMALINK = "https://xinjinjumin439852283112.lofter.com/post/b37e3ea3_3f94b4155";

function permalinkPage(...bigimgsrcs: string[]): string {
  const anchors = bigimgsrcs
    .map(
      (url) => `      <a href="${PERMALINK}" bigimgsrc="${url}"><img src="${url}?thumbnail=1"></a>`,
    )
    .join("\n");
  return `<html><body><div class="post photo">\n${anchors}\n</div></body></html>`;
}

function makeResults(
  posts: Array<{ contentUrl: string; pageUrl?: string; sources?: string[] }>,
  engine = "lofter",
): ScrapeResults {
  return {
    results: [
      {
        engine,
        description: "",
        posts: posts.map((p) => ({ contentType: "image", uploadMode: "url", ...p })),
      },
    ],
  } as unknown as ScrapeResults;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bigimgsrcUrlsFromHtml", () => {
  it("extracts, query-strips and orders the bigimgsrc renditions", () => {
    const html = permalinkPage(`${largeA}?imageView&thumbnail=1680x0&quality=96&stripmeta=0&type=jpg`, `${largeB}?imageView&thumbnail=1680x0&quality=96&stripmeta=0&type=jpg`);
    expect(bigimgsrcUrlsFromHtml(html)).toEqual([largeA, largeB]);
  });

  it("drops non-CDN values and dedupes double renders", () => {
    const html = permalinkPage(
      "https://cdn.example.com/not-a-lofter-image.jpg",
      largeA,
      largeA,
    );
    expect(bigimgsrcUrlsFromHtml(html)).toEqual([largeA]);
  });

  it("returns no urls for a login wall (no bigimgsrc anchors)", () => {
    expect(bigimgsrcUrlsFromHtml("<html><body><div id='application'></div></body></html>")).toEqual([]);
  });
});

describe("upgradeLofterPosts", () => {
  it("swaps a single-image post to the permalink rendition", async () => {
    const fetcher = vi.fn(async () => permalinkPage(`${largeA}?imageView&thumbnail=1680x0&type=jpg`));
    const results = makeResults([{ contentUrl: feedA, pageUrl: PERMALINK }]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(1);
    expect(results.results[0].posts[0].contentUrl).toBe(largeA);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(PERMALINK);
  });

  it("takes the rendition from sources when pageUrl is the feed page", async () => {
    const fetcher = vi.fn(async () => permalinkPage(largeA));
    const results = makeResults([{ contentUrl: feedA, pageUrl: "https://www.lofter.com/tag/sometag", sources: [PERMALINK] }]);

    await upgradeLofterPosts(results, fetcher);

    expect(results.results[0].posts[0].contentUrl).toBe(largeA);
    expect(fetcher).toHaveBeenCalledWith(PERMALINK);
  });

  it("pairs equal counts positionally (multi-image post)", async () => {
    const fetcher = vi.fn(async () => permalinkPage(largeA, largeB));
    const results = makeResults([
      { contentUrl: feedA, pageUrl: PERMALINK },
      { contentUrl: feedB, pageUrl: PERMALINK },
    ]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(2);
    expect(results.results[0].posts[0].contentUrl).toBe(largeA);
    expect(results.results[0].posts[1].contentUrl).toBe(largeB);
    // One fetch serves the whole card.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the feed renditions on a count mismatch", async () => {
    const fetcher = vi.fn(async () => permalinkPage(largeA, largeB));
    const results = makeResults([{ contentUrl: feedA, pageUrl: PERMALINK }]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(0);
    expect(results.results[0].posts[0].contentUrl).toBe(feedA);
  });

  it("is a no-op when the content url already is the permalink rendition", async () => {
    const fetcher = vi.fn(async () => permalinkPage(largeA));
    const results = makeResults([{ contentUrl: largeA, pageUrl: PERMALINK }]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(0);
    expect(results.results[0].posts[0].contentUrl).toBe(largeA);
  });

  it("keeps the scraped urls when the permalink fetch fails", async () => {
    const fetcher = vi.fn(async () => null);
    const results = makeResults([{ contentUrl: feedA, pageUrl: PERMALINK }]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(0);
    expect(results.results[0].posts[0].contentUrl).toBe(feedA);
  });

  it("keeps the scraped urls when the fetch throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const results = makeResults([{ contentUrl: feedA, pageUrl: PERMALINK }]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(0);
    expect(results.results[0].posts[0].contentUrl).toBe(feedA);
  });

  it("skips extensionless content urls and posts without a permalink", async () => {
    const fetcher = vi.fn(async () => permalinkPage(largeA));
    const results = makeResults([
      // Themed-page grabs already resolve the extensionless rendition.
      { contentUrl: "https://imglf3.lf127.net/img/04cd26a9a07e8625/bC9RU05VOUQvNWdMd2gxNVArNHA1Q0dHYlZSRXo3a1RLbDRKdk1UUT", pageUrl: PERMALINK },
      // Viewer-overlay content-only grabs have no post page.
      { contentUrl: feedA, pageUrl: "https://www.lofter.com/tag/sometag" },
    ]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("touches only the lofter engine's results", async () => {
    const fetcher = vi.fn(async () => permalinkPage(largeA));
    const results = makeResults([{ contentUrl: feedA, pageUrl: PERMALINK }], "twitter");

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(upgraded).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(results.results[0].posts[0].contentUrl).toBe(feedA);
  });

  it("fetches each distinct permalink separately", async () => {
    const other = "https://someauthor.lofter.com/post/1fabcd12_34efabcd";
    const fetcher = vi.fn(async (permalink: string) =>
      permalink == PERMALINK ? permalinkPage(largeA) : permalinkPage(largeB),
    );
    const results = makeResults([
      { contentUrl: feedA, pageUrl: PERMALINK },
      { contentUrl: feedB, pageUrl: other },
    ]);

    const upgraded = await upgradeLofterPosts(results, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(upgraded).toBe(2);
    expect(results.results[0].posts[0].contentUrl).toBe(largeA);
    expect(results.results[0].posts[1].contentUrl).toBe(largeB);
  });
});

describe("fetchLofterPermalinkHtml", () => {
  function htmlResponse(ok: boolean, contentType: string): Response {
    return {
      ok,
      headers: { get: (name: string) => (name == "Content-Type" ? contentType : null) },
      text: async () => "<html></html>",
    } as unknown as Response;
  }

  it("returns the body for html responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(true, "text/html;charset=utf-8")));
    await expect(fetchLofterPermalinkHtml(PERMALINK)).resolves.toBe("<html></html>");
  });

  it("carries credentials so the user's lofter session rides along", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(true, "text/html"));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLofterPermalinkHtml(PERMALINK);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("rejects non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(false, "text/html")));
    await expect(fetchLofterPermalinkHtml(PERMALINK)).resolves.toBeNull();
  });

  it("rejects non-html responses (CDN media, gates)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(true, "application/octet-stream")));
    await expect(fetchLofterPermalinkHtml(PERMALINK)).resolves.toBeNull();
  });
});
