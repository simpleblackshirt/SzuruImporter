import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScrapedPostDetails } from "~/models";
import { resolvePostsContent } from "./useContentResolve";

/**
 * The bridge between the site adapters' resolvers and the popup view models:
 * successful resolutions apply field-by-field, failures land in every
 * instance's genericError banner (see PopupMain).
 */

const makePost = (overrides: Record<string, unknown> = {}): ScrapedPostDetails =>
  ({
    id: "post-1",
    name: "[twitter] Post 1",
    contentType: "video",
    contentUrl: "blob:https://x.com/4b20164f-79d1-4da5-b72f-0be72e8e18cf",
    pageUrl: "https://x.com/ArtistOne/status/333",
    source: "https://x.com/ArtistOne/status/333",
    resolution: undefined,
    previewUrl: undefined,
    resolvedContent: undefined,
    instanceSpecificData: { "site-1": {}, "site-2": {} },
    ...overrides,
  }) as unknown as ScrapedPostDetails;

function jsonResponse(body: any, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const syndicationVideoTweet = {
  mediaDetails: [
    {
      type: "video",
      video_info: {
        variants: [
          { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/1/pl/x.m3u8" },
          { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4" },
        ],
      },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePostsContent", () => {
  it("applies a successful twitter resolution field-by-field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(syndicationVideoTweet)));

    const post = makePost();
    await resolvePostsContent([post]);

    expect(post.contentUrl).toBe("https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/C.mp4");
    expect(post.resolution).toEqual([720, 1280]);
    expect(post.resolvedContent).toBeUndefined();
    expect(post.name).toBe("[twitter] Post 1 (video)");
    for (const data of Object.values(post.instanceSpecificData)) {
      expect(data.genericError).toBeUndefined();
    }
  });

  it("shows resolution failures in every instance's error banner and keeps the scraped state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const post = makePost();
    await resolvePostsContent([post]);

    expect(post.contentUrl).toBe("blob:https://x.com/4b20164f-79d1-4da5-b72f-0be72e8e18cf");
    expect(post.resolvedContent).toBeUndefined();
    for (const data of Object.values(post.instanceSpecificData)) {
      expect(data.genericError).toBe("Twitter video resolution failed: offline");
    }
  });

  it("shows bluesky classification failures (network) on bluesky posts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        if (String(url).includes("resolveHandle")) {
          return jsonResponse({ did: "did:plc:xyz" });
        }
        return jsonResponse({}, 500);
      }),
    );

    const post = makePost({
      pageUrl: "https://bsky.app/profile/artist.bsky.social/post/3kabc123",
      source: "https://bsky.app/profile/artist.bsky.social/post/3kabc123",
      contentType: "image",
      contentUrl: "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkrei",
    });
    await resolvePostsContent([post]);

    for (const data of Object.values(post.instanceSpecificData)) {
      expect(data.genericError).toContain("Bluesky video classification failed:");
    }
  });

  it("leaves posts without a matching resolver untouched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const post = makePost({ pageUrl: "https://danbooru.donmai.us/posts/1", source: "" });
    await resolvePostsContent([post]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(post.contentUrl).toBe("blob:https://x.com/4b20164f-79d1-4da5-b72f-0be72e8e18cf");
  });
});
