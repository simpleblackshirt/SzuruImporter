import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const testCtx = vi.hoisted(() => {
  const browserStub = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
  return { browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

import { cfg, usePopupStore } from "~/stores";
import { useSimilarSearch } from "./useSimilarSearch";

const SITE_ID = "test-site";

const fakeApi = {
  uploadTempFileFromUrl: vi.fn(async () => ({ token: "token-1" })),
  reverseSearchToken: vi.fn(async () => ({ exactPost: undefined, similarPosts: [] })),
};

function makeSelectedPost() {
  return {
    id: "post-1",
    contentUrl: "https://cdn.example.com/img.jpg",
    pageUrl: "",
    contentType: "image",
    rating: "safe",
    sources: [],
    tags: [],
    notes: [],
    uploadMode: "url",
    // resolvedContent takes findSimilar's throwaway-token branch, keeping the
    // test away from the content-token path (ensurePostHasContentToken).
    resolvedContent: { kind: "hls-mp4", playlistUrl: "https://video.example/playlist.m3u8" },
    // Pre-keyed per configured site, mirroring materializeScrapeResults.
    instanceSpecificData: { [SITE_ID]: {} } as Record<string, any>,
  };
}

async function makeComposable() {
  setActivePinia(createPinia());
  const pop = usePopupStore();
  const post = makeSelectedPost();
  pop.posts.push(post as any);
  pop.selectedPostId = post.id;
  cfg.value.selectedSiteId = SITE_ID;
  const composable = useSimilarSearch({ value: fakeApi } as any);
  return { pop, post, ...composable };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("clickFindSimilar pipeline gate", () => {
  it("does not search while the grab pipeline is running", async () => {
    const { pop, post, clickFindSimilar } = await makeComposable();
    pop.grabPipelineRunning = true;

    await clickFindSimilar();

    expect(fakeApi.uploadTempFileFromUrl).not.toHaveBeenCalled();
    expect(fakeApi.reverseSearchToken).not.toHaveBeenCalled();
    expect(post.instanceSpecificData[SITE_ID]?.reverseSearchResult).toBeUndefined();
  });

  it("searches once the pipeline has settled", async () => {
    const { post, clickFindSimilar } = await makeComposable();

    await clickFindSimilar();

    expect(fakeApi.uploadTempFileFromUrl).toHaveBeenCalledTimes(1);
    expect(fakeApi.reverseSearchToken).toHaveBeenCalledTimes(1);
    expect(post.instanceSpecificData[SITE_ID]?.reverseSearchResult).toBeDefined();
  });
});
