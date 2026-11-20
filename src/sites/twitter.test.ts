import { afterEach, describe, expect, it, vi } from "vitest";
import twitter, {
  bestMp4VariantFromTweet,
  statusIdFromPost,
  syndicationTokenForStatus,
  syndicationUrlForStatus,
} from "./twitter";
import type { ResolvablePost } from "./index";

// A video tweet exactly as cdn.syndication.twimg.com/tweet-result returned it
// (live capture 2026-11-20, @WhatsTrending/status/2116523086195363921).
const syndicationVideoTweet = {
  __typename: "Tweet",
  possibly_sensitive: false,
  mediaDetails: [
    {
      type: "video",
      video_info: {
        duration_millis: 60566,
        aspect_ratio: [9, 16],
        variants: [
          { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/1/pl/x.m3u8" },
          { content_type: "video/mp4", bitrate: 632000, url: "https://video.twimg.com/amplify_video/1/vid/avc1/320x568/A.mp4" },
          { content_type: "video/mp4", bitrate: 950000, url: "https://video.twimg.com/amplify_video/1/vid/avc1/480x852/B.mp4" },
          { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4" },
        ],
      },
    },
  ],
  video: {
    variants: [
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/1/pl/x.m3u8" },
      { content_type: "video/mp4", url: "https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4" },
    ],
  },
};

const makePost = (overrides: Partial<ResolvablePost> = {}): ResolvablePost => ({
  id: "post-1",
  contentType: "video",
  contentUrl: "blob:https://x.com/4b20164f-79d1-4da5-b72f-0be72e8e18cf",
  pageUrl: "https://x.com/ArtistOne/status/333",
  source: "https://x.com/ArtistOne/status/333",
  ...overrides,
});

function jsonResponse(body: any, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("twitter site adapter", () => {
  it("should declare the page hosts of the neo-scraper Twitter engine", () => {
    // Host data copied from neo-scraper src/engines/Twitter.ts @ efcea42.
    expect(twitter.hosts).toEqual(["twitter.com", "mobile.twitter.com", "x.com"]);
  });

  it("should carry the status family for x.com/twitter.com source dedup", () => {
    // Relocated verbatim from the former utils POST_ID_FAMILIES entry.
    expect(twitter.sourceFamilies).toEqual([{ hosts: ["x.com", "twitter.com"], idPath: /\/status\/[^/]+$/ }]);
  });

  it("should carry a content resolver (video placeholder posts)", () => {
    expect(twitter.resolveContent).toBeDefined();
  });
});

describe("syndicationTokenForStatus", () => {
  it("derives the token the syndication endpoint expects", () => {
    // Exact value verified against the live endpoint (200 response).
    expect(syndicationTokenForStatus("1683920951807971329")).toBe("42y6zv7ufp");
  });

  it("builds the full lookup url", () => {
    expect(syndicationUrlForStatus("333")).toBe(
      "https://cdn.syndication.twimg.com/tweet-result?id=333&token=" + syndicationTokenForStatus("333") + "&lang=en",
    );
  });
});

describe("statusIdFromPost", () => {
  it("takes the id from the page url", () => {
    expect(statusIdFromPost(makePost())).toBe("333");
  });

  it("falls back to the source urls", () => {
    expect(statusIdFromPost(makePost({ pageUrl: "https://x.com/home", source: "https://x.com/a/status/999" }))).toBe("999");
  });

  it("returns undefined without any status url", () => {
    expect(statusIdFromPost(makePost({ pageUrl: "https://x.com/home", source: "" }))).toBeUndefined();
  });
});

describe("bestMp4VariantFromTweet", () => {
  it("picks the highest-bitrate mp4 variant", () => {
    expect(bestMp4VariantFromTweet(syndicationVideoTweet)).toEqual({
      url: "https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4",
      bitrate: 2176000,
    });
  });

  it("ignores m3u8 (hls) variants", () => {
    const urls = (bestMp4VariantFromTweet(syndicationVideoTweet)!.url);
    expect(urls.endsWith(".mp4")).toBe(true);
  });

  it("falls back to video.variants when mediaDetails carries no video", () => {
    const photoTweet = { ...syndicationVideoTweet, mediaDetails: [{ type: "photo" }] };
    expect(bestMp4VariantFromTweet(photoTweet)?.url).toBe("https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4");
  });

  it("returns undefined for photo tweets", () => {
    expect(bestMp4VariantFromTweet({ mediaDetails: [{ type: "photo" }] })).toBeUndefined();
    expect(bestMp4VariantFromTweet({})).toBeUndefined();
  });
});

describe("twitter content resolver", () => {
  it("swaps a blob placeholder for the best mp4 and extracts resolution", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(syndicationVideoTweet));
    vi.stubGlobal("fetch", fetchMock);

    const results = await twitter.resolveContent!.resolve([makePost()]);

    expect(fetchMock.mock.calls[0][0]).toContain("id=333");
    expect(results[0]?.contentUrl).toBe("https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4");
    expect(results[0]?.resolution).toEqual([720, 1280]);
    expect(results[0]?.rating).toBeUndefined();
  });

  it("maps possibly_sensitive to the sketchy rating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...syndicationVideoTweet, possibly_sensitive: true })));

    const results = await twitter.resolveContent!.resolve([makePost()]);

    expect(results[0]?.rating).toBe("sketchy");
  });

  it("leaves image posts and direct twimg urls untouched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const results = await twitter.resolveContent!.resolve([
      makePost({ id: "a", contentType: "image", contentUrl: "https://pbs.twimg.com/media/X?format=jpg&name=orig" }),
      makePost({ id: "b", contentUrl: "https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4" }),
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([undefined, undefined]);
  });

  it("resolves to undefined (kept state) when the tweet has no video", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ mediaDetails: [{ type: "photo" }] })));

    const results = await twitter.resolveContent!.resolve([makePost()]);

    expect(results[0]).toBeUndefined();
  });

  it("surfaces lookup failures as per-post errors - one post must not sink the batch", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(syndicationVideoTweet));
    vi.stubGlobal("fetch", fetchMock);

    const results = await twitter.resolveContent!.resolve([makePost({ id: "a" }), makePost({ id: "b", pageUrl: "https://x.com/a/status/444", source: "https://x.com/a/status/444" })]);

    expect(results[0]?.error).toBe("Twitter video resolution failed: offline");
    expect(results[0]?.contentUrl).toBeUndefined();
    expect(results[1]?.contentUrl).toBe("https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4");
  });
});
