import { afterEach, describe, expect, it, vi } from "vitest";
import bluesky, { atUriPartsFromUrl, videoEmbedView } from "./bluesky";
import type { ResolvablePost } from "./index";

const makePost = (overrides: Partial<ResolvablePost> = {}): ResolvablePost => ({
  id: "post-1",
  contentType: "image",
  contentUrl: "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkrei poster",
  pageUrl: "https://bsky.app/profile/artist.bsky.social/post/3kabc123",
  source: "https://bsky.app/profile/artist.bsky.social/post/3kabc123",
  ...overrides,
});

const videoPostView = {
  uri: "at://did:plc:xyz/app.bsky.feed.post/3kabc123",
  embed: {
    $type: "app.bsky.embed.video#view",
    playlist: "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/playlist.m3u8",
    thumbnail: "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/thumbnail.jpg",
    aspectRatio: { width: 1080, height: 1728 },
  },
};

function jsonResponse(body: any, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("atUriPartsFromUrl", () => {
  it("parses handle and record key from permalinks", () => {
    expect(atUriPartsFromUrl("https://bsky.app/profile/artist.bsky.social/post/3kabc123")).toEqual({
      handle: "artist.bsky.social",
      rkey: "3kabc123",
    });
    expect(atUriPartsFromUrl("/profile/artist.bsky.social/post/3kabc123")).toEqual({
      handle: "artist.bsky.social",
      rkey: "3kabc123",
    });
  });

  it("returns undefined for profile urls and garbage", () => {
    expect(atUriPartsFromUrl("https://bsky.app/profile/artist.bsky.social")).toBeUndefined();
    expect(atUriPartsFromUrl("not a url")).toBeUndefined();
  });
});

describe("videoEmbedView", () => {
  it("finds direct video embeds", () => {
    expect(videoEmbedView(videoPostView.embed)?.playlist).toBe(videoPostView.embed.playlist);
  });

  it("walks record-with-media nests", () => {
    const nested = { $type: "app.bsky.embed.recordWithMedia#view", media: videoPostView.embed };
    expect(videoEmbedView(nested)?.playlist).toBe(videoPostView.embed.playlist);
  });

  it("ignores images, records (quote-only videos) and missing embeds", () => {
    expect(videoEmbedView({ $type: "app.bsky.embed.images#view" })).toBeUndefined();
    expect(videoEmbedView({ $type: "app.bsky.embed.record#view", record: { embeds: [videoPostView.embed] } })).toBeUndefined();
    expect(videoEmbedView(undefined)).toBeUndefined();
  });
});

describe("bluesky content resolver", () => {
  function stubApis(posts: any[]) {
    const fetchMock = vi.fn(async (url: any) => {
      const target = String(url);
      if (target.includes("resolveHandle")) {
        return jsonResponse({ did: "did:plc:xyz" });
      }
      if (target.includes("getPosts")) {
        return jsonResponse({ posts });
      }
      throw new Error(`unexpected fetch: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("classifies via the batched getPosts call and plans the HLS transmux for videos", async () => {
    const fetchMock = stubApis([videoPostView]);

    const results = await bluesky.resolveContent!.resolve([makePost()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("resolveHandle?handle=artist.bsky.social"))).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(
      "uris=" + encodeURIComponent("at://did:plc:xyz/app.bsky.feed.post/3kabc123"),
    );

    expect(results[0]?.plan).toEqual({
      kind: "hls-mp4",
      playlistUrl: "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/playlist.m3u8",
    });
    expect(results[0]?.contentType).toBe("video");
    expect(results[0]?.uploadMode).toBe("content");
    // The poster stays as preview: the popup renders it via <video poster>.
    expect(results[0]?.previewUrl).toBe(makePost().contentUrl);
    expect(results[0]?.resolution).toEqual([1080, 1728]);
  });

  it("batches getPosts at 25 uris per call", async () => {
    const fetchMock = stubApis([]);
    const posts = Array.from({ length: 30 }, (_, i) =>
      makePost({ id: `p${i}`, pageUrl: `https://bsky.app/profile/artist.bsky.social/post/rkey${i}`, source: "" }),
    );

    await bluesky.resolveContent!.resolve(posts);

    const getPostsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("getPosts"));
    expect(getPostsCalls).toHaveLength(2);
  });

  it("keeps image posts in their scraped state", async () => {
    stubApis([
      {
        uri: "at://did:plc:xyz/app.bsky.feed.post/3kabc123",
        embed: { $type: "app.bsky.embed.images#view", images: [] },
      },
    ]);

    const results = await bluesky.resolveContent!.resolve([makePost()]);

    expect(results[0]).toBeUndefined();
  });

  it("keeps posts without a permalink (profile-page quote cards) unresolved", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const results = await bluesky.resolveContent!.resolve([
      makePost({ pageUrl: "https://bsky.app/profile/artist.bsky.social", source: "" }),
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results[0]).toBeUndefined();
  });

  it("keeps posts whose getPosts view is unavailable (deleted / logged-out-disabled)", async () => {
    stubApis([]); // getPosts returns no matching post

    const results = await bluesky.resolveContent!.resolve([makePost()]);

    expect(results[0]).toBeUndefined();
  });

  it("flags getPosts failures on every post (a video must not silently upload as its poster image)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        if (String(url).includes("resolveHandle")) {
          return jsonResponse({ did: "did:plc:xyz" });
        }
        return jsonResponse({}, 403);
      }),
    );

    const results = await bluesky.resolveContent!.resolve([makePost({ id: "a" }), makePost({ id: "b" })]);

    expect(results[0]?.error).toContain("Bluesky video classification failed:");
    expect(results[0]?.error).toContain("status 403");
    expect(results[1]?.error).toContain("status 403");
    expect(results[0]?.contentUrl).toBeUndefined();
  });
});
