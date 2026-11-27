import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createPinia, setActivePinia } from "pinia";

const testCtx = vi.hoisted(() => {
  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
  return { browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

import { cfg, usePopupStore } from "~/stores";
import { useGrabPost } from "./useGrabPost";

// The serialized ScrapeResults shape as it arrives from the content script /
// stash: class prototypes lost, and only own properties survive - the posts
// getter is gone, so the wire shape carries results only.
const scrapedPost = {
  contentUrl: "https://pbs.twimg.com/media/abc.jpg",
  contentType: "image",
  pageUrl: "",
  rating: "safe",
  sources: [],
  tags: [],
  notes: [],
  uploadMode: "url",
};
const stashedScrapeResults = {
  results: [{ engine: "twitter", description: "", posts: [scrapedPost] }],
};

function makeDeps() {
  return {
    enableAutoSearch: ref(true),
    findSimilar: vi.fn().mockResolvedValue(undefined),
    loadTagCounts: vi.fn().mockResolvedValue(undefined),
    fetchPostsInfo: vi.fn().mockResolvedValue(undefined),
  };
}

async function makeComposable() {
  setActivePinia(createPinia());
  const deps = makeDeps();
  const composable = useGrabPost(deps);
  // Keep populatePosts offline and deterministic per test.
  cfg.value.fetchPostInfo = false;
  cfg.value.loadTagCounts = false;
  cfg.value.resolveTagAliases = false;
  cfg.value.autoSearchSimilar = false;
  return { pop: usePopupStore(), deps, ...composable };
}

beforeEach(() => {
  vi.clearAllMocks();
  testCtx.browserStub.storage.local.get.mockResolvedValue({});
  testCtx.browserStub.storage.local.remove.mockResolvedValue(undefined);
  testCtx.browserStub.tabs.query.mockResolvedValue([]);
});

describe("pickupStashedGrab", () => {
  it("populates the popup from a fresh stash and removes the key afterwards", async () => {
    const { pop, pickupStashedGrab } = await makeComposable();
    const stash = { grabbedAt: Date.now(), targetUrl: "https://x.com/status/123", scrapeResults: stashedScrapeResults };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    const picked = await pickupStashedGrab();

    expect(picked).toBe("picked");
    expect(pop.posts).toHaveLength(1);
    expect(pop.posts[0].name).toBe("[twitter] Post 1");
    expect(pop.selectedPostId).toBe(pop.posts[0].id);
    expect(pop.contextGrabError).toBeUndefined();
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("returns 'none' when there is no stash", async () => {
    const { pop, pickupStashedGrab } = await makeComposable();

    const picked = await pickupStashedGrab();

    expect(picked).toBe("none");
    expect(pop.posts).toHaveLength(0);
    expect(testCtx.browserStub.storage.local.remove).not.toHaveBeenCalled();
  });

  it("surfaces a failure record as the banner and does not grab the tab", async () => {
    const { pop, pickupStashedGrab } = await makeComposable();
    const stash = { grabbedAt: Date.now(), targetUrl: "https://x.com/status/123", error: "No post found under the right-clicked element." };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    const picked = await pickupStashedGrab();

    expect(picked).toBe("failed");
    expect(pop.contextGrabError).toBe("No post found under the right-clicked element.");
    expect(pop.posts).toHaveLength(0);
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("discards a stash older than the ttl", async () => {
    const { pickupStashedGrab } = await makeComposable();
    const stash = {
      grabbedAt: Date.now() - 6 * 60 * 1000,
      targetUrl: "https://x.com/status/123",
      scrapeResults: stashedScrapeResults,
    };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    const picked = await pickupStashedGrab();

    expect(picked).toBe("none");
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("discards a malformed stash and never blocks the popup", async () => {
    const { pop, pickupStashedGrab } = await makeComposable();
    // results as a number makes materializeScrapeResults throw.
    const stash = { grabbedAt: Date.now(), targetUrl: "", scrapeResults: { results: 5 } };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    const picked = await pickupStashedGrab();

    expect(picked).toBe("none");
    expect(pop.posts).toHaveLength(0);
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("keeps the stash when storage reads fail", async () => {
    const { pickupStashedGrab } = await makeComposable();
    testCtx.browserStub.storage.local.get.mockRejectedValue(new Error("storage broken"));

    const picked = await pickupStashedGrab();

    expect(picked).toBe("none");
    expect(testCtx.browserStub.storage.local.remove).not.toHaveBeenCalled();
  });
});

describe("auto reverse search", () => {
  it("runs for image posts when autoSearchSimilar is on", async () => {
    const { pop, pickupStashedGrab, deps } = await makeComposable();
    cfg.value.autoSearchSimilar = true;
    const stash = { grabbedAt: Date.now(), targetUrl: "", scrapeResults: stashedScrapeResults };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    await pickupStashedGrab();

    expect(pop.posts).toHaveLength(1);
    expect(deps.findSimilar).toHaveBeenCalledTimes(1);
  });

  it("skips video posts (the exact-match search would download the whole media on mere selection)", async () => {
    const { pop, pickupStashedGrab, deps } = await makeComposable();
    cfg.value.autoSearchSimilar = true;
    const videoScrapeResults = {
      results: [{ engine: "twitter", description: "", posts: [{ ...scrapedPost, contentType: "video" }] }],
    };
    const stash = { grabbedAt: Date.now(), targetUrl: "", scrapeResults: videoScrapeResults };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    await pickupStashedGrab();

    expect(pop.posts).toHaveLength(1);
    expect(deps.findSimilar).not.toHaveBeenCalled();
  });
});

describe("grab pipeline gate", () => {
  it("raises grabPipelineRunning during the pipeline and clears it after", async () => {
    const { pop, pickupStashedGrab, deps } = await makeComposable();
    const stash = { grabbedAt: Date.now(), targetUrl: "", scrapeResults: stashedScrapeResults };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });
    // Observed from inside the gated section (the info probe): uploads and
    // manual searches are locked out while urls may still change, and the
    // gate is cleared by the time populatePosts returns (the final
    // findSimilar call correctly runs after it).
    const runningDuringPipeline: boolean[] = [];
    deps.fetchPostsInfo.mockImplementation(async () => {
      runningDuringPipeline.push(pop.grabPipelineRunning);
    });
    cfg.value.fetchPostInfo = true;

    await pickupStashedGrab();

    expect(runningDuringPipeline).toEqual([true]);
    expect(pop.grabPipelineRunning).toBe(false);
  });

  it("clears the gate even when the pipeline throws", async () => {
    const { pop, pickupStashedGrab, deps } = await makeComposable();
    // Run the probe stage so its rejection crosses the gate.
    cfg.value.fetchPostInfo = true;
    deps.fetchPostsInfo.mockRejectedValue(new Error("probe broken"));
    const stash = { grabbedAt: Date.now(), targetUrl: "", scrapeResults: stashedScrapeResults };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    await expect(pickupStashedGrab()).rejects.toThrow("probe broken");
    expect(pop.grabPipelineRunning).toBe(false);
  });
});

describe("grabPost (tab grab, regression guard)", () => {
  it("still populates the popup from the active tabs when no stash exists", async () => {
    const { pop, grabPost } = await makeComposable();
    testCtx.browserStub.tabs.query.mockResolvedValue([{ id: 1, highlighted: true }]);
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(stashedScrapeResults);

    await grabPost();

    expect(pop.posts).toHaveLength(1);
    expect(pop.posts[0].name).toBe("[twitter] Post 1");
    expect(testCtx.browserStub.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ name: "grab_post" }));
  });
});
