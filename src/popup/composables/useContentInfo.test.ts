import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScrapedPostDetails } from "~/models";
import { updatePostWithRemoteInfo } from "./useContentInfo";

function makePost(overrides: Partial<ScrapedPostDetails> = {}): ScrapedPostDetails {
  return {
    contentUrl: "https://cdn.example.com/img.png",
    contentSize: undefined,
    contentSubType: undefined,
    ...overrides,
  } as ScrapedPostDetails;
}

function headResponse(headers: Record<string, string>, finalUrl?: string): Response {
  return {
    url: finalUrl ?? "https://cdn.example.com/img.png",
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updatePostWithRemoteInfo (HEAD probing)", () => {
  // Failure mode caught: a login/permission wall served as text/html would be
  // misread as a valid image (or crash the subtype split) instead of failing.
  it("rejects text/html responses without applying any of their data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => headResponse({ "Content-Type": "text/html" })));

    const post = makePost();
    const ok = await updatePostWithRemoteInfo(post, post.contentUrl);

    expect(ok).toBe(false);
    expect(post.contentSubType).toBeUndefined();
    expect(post.contentSize).toBeUndefined();
  });

  it("extracts subtype and size from the HEAD response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => headResponse({ "Content-Type": "image/jpeg", "Content-Length": "2048" })),
    );

    const post = makePost();
    const ok = await updatePostWithRemoteInfo(post, post.contentUrl);

    expect(ok).toBe(true);
    expect(post.contentSubType).toBe("JPEG");
    expect(post.contentSize).toBe(2048);
  });

  // Failure mode caught: with uploadMode "url" the server would be pointed at
  // the stale pre-redirect url.
  it("adopts the final url after a redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => headResponse({ "Content-Type": "image/png" }, "https://cdn.example.com/redirected.png")),
    );

    const post = makePost();
    const ok = await updatePostWithRemoteInfo(post, post.contentUrl);

    expect(ok).toBe(true);
    expect(post.contentUrl).toBe("https://cdn.example.com/redirected.png");
  });

  it("reports failure when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const post = makePost();
    const ok = await updatePostWithRemoteInfo(post, post.contentUrl);

    expect(ok).toBe(false);
  });
});
