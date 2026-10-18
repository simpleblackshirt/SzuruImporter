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

    expect(picked).toBe(true);
    expect(pop.posts).toHaveLength(1);
    expect(pop.posts[0].name).toBe("[twitter] Post 1");
    expect(pop.selectedPostId).toBe(pop.posts[0].id);
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("returns false when there is no stash", async () => {
    const { pop, pickupStashedGrab } = await makeComposable();

    const picked = await pickupStashedGrab();

    expect(picked).toBe(false);
    expect(pop.posts).toHaveLength(0);
    expect(testCtx.browserStub.storage.local.remove).not.toHaveBeenCalled();
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

    expect(picked).toBe(false);
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("discards a malformed stash and never blocks the popup", async () => {
    const { pop, pickupStashedGrab } = await makeComposable();
    // results as a number makes materializeScrapeResults throw.
    const stash = { grabbedAt: Date.now(), targetUrl: "", scrapeResults: { results: 5 } };
    testCtx.browserStub.storage.local.get.mockResolvedValue({ contextGrabStash: stash });

    const picked = await pickupStashedGrab();

    expect(picked).toBe(false);
    expect(pop.posts).toHaveLength(0);
    expect(testCtx.browserStub.storage.local.remove).toHaveBeenCalledWith("contextGrabStash");
  });

  it("keeps the stash when storage reads fail", async () => {
    const { pickupStashedGrab } = await makeComposable();
    testCtx.browserStub.storage.local.get.mockRejectedValue(new Error("storage broken"));

    const picked = await pickupStashedGrab();

    expect(picked).toBe(false);
    expect(testCtx.browserStub.storage.local.remove).not.toHaveBeenCalled();
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
