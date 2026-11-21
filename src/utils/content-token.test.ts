import { describe, expect, it, vi } from "vitest";
import type { ScrapedPostDetails } from "~/models";
import { ensurePostHasContentToken } from "./content-token";

const makePost = (overrides: Record<string, unknown> = {}): ScrapedPostDetails =>
  ({
    contentUrl: "https://video.bsky.app/watch/x/thumbnail.jpg",
    uploadMode: "content",
    instanceSpecificData: { "site-1": {} },
    ...overrides,
  }) as unknown as ScrapedPostDetails;

const cfg = { value: { selectedSiteId: "site-1" } };

describe("ensurePostHasContentToken", () => {
  it("uploads the content url and caches its token", async () => {
    const selectedInstance = {
      uploadTempFile: vi.fn().mockResolvedValue({ token: "token-1" }),
    } as any;

    const post = makePost();
    await ensurePostHasContentToken(selectedInstance, post, cfg);

    expect(selectedInstance.uploadTempFile).toHaveBeenCalledWith(post.contentUrl, "content");
    expect(post.instanceSpecificData["site-1"].contentToken).toBe("token-1");
  });

  it("never caches a token for resolved-content posts (their placeholder url is not the real content)", async () => {
    const selectedInstance = {
      uploadTempFile: vi.fn(),
    } as any;

    const post = makePost({ resolvedContent: { kind: "hls-mp4", playlistUrl: "https://video.bsky.app/watch/x/playlist.m3u8" } });
    await ensurePostHasContentToken(selectedInstance, post, cfg);

    expect(selectedInstance.uploadTempFile).not.toHaveBeenCalled();
    expect(post.instanceSpecificData["site-1"].contentToken).toBeUndefined();
  });

  it("keeps an already-cached token", async () => {
    const selectedInstance = { uploadTempFile: vi.fn() } as any;

    const post = makePost({ instanceSpecificData: { "site-1": { contentToken: "existing" } } });
    await ensurePostHasContentToken(selectedInstance, post, cfg);

    expect(selectedInstance.uploadTempFile).not.toHaveBeenCalled();
    expect(post.instanceSpecificData["site-1"].contentToken).toBe("existing");
  });
});
