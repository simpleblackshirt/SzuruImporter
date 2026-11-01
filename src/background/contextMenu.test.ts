import { beforeEach, describe, expect, it, vi } from "vitest";

const testCtx = vi.hoisted(() => {
  const browserStub: any = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      // Absent on Chromium - set per test for the Firefox paths.
      getBrowserInfo: undefined as any,
    },
    action: { openPopup: vi.fn().mockResolvedValue(undefined) },
    contextMenus: {
      removeAll: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    tabs: { sendMessage: vi.fn() },
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

// The content-script response after crossing the message boundary: plain JSON.
// JSON.stringify only serializes own properties, so ScrapeResults.posts (a
// getter) is gone - the wire shape carries results only.
const grabbedPost = { contentUrl: "https://pbs.twimg.com/media/abc.jpg?format=jpg&name=orig", contentType: "image" };
const grabbedResponse = {
  status: "ok",
  scrapeResults: {
    results: [{ engine: "twitter", description: "", posts: [grabbedPost] }],
  },
};

const clickInfo = (overrides: Record<string, unknown> = {}) => ({
  menuItemId: "szuru-grab-element",
  pageUrl: "https://x.com/someone/status/123",
  frameId: 0,
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Imports the module fresh and returns the registered listeners. */
async function initMenu() {
  vi.resetModules();
  await import("./contextMenu");
  const registered = testCtx.browserStub.runtime.onInstalled.addListener.mock.calls.at(-1)?.[0];
  const onClicked = testCtx.browserStub.contextMenus.onClicked.addListener.mock.calls.at(-1)?.[0];
  return { onInstalled: registered as () => void, onClicked: onClicked as (info: any, tab?: any) => Promise<void> };
}

const firefox = (version: string) => {
  testCtx.browserStub.runtime.getBrowserInfo = vi.fn().mockResolvedValue({ name: "Firefox", vendor: "Mozilla", version });
};

beforeEach(() => {
  vi.clearAllMocks();
  testCtx.browserStub.runtime.getBrowserInfo = undefined; // Chromium path
  testCtx.browserStub.contextMenus.removeAll.mockResolvedValue(undefined);
  testCtx.browserStub.action.openPopup.mockResolvedValue(undefined);
  testCtx.browserStub.storage.local.set.mockResolvedValue(undefined);
});

describe("menu registration", () => {
  it("removes and creates the menu item on install (Chromium)", async () => {
    const { onInstalled } = await initMenu();

    onInstalled();
    await flush();

    expect(testCtx.browserStub.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(testCtx.browserStub.contextMenus.create).toHaveBeenCalledTimes(1);
    const [props] = testCtx.browserStub.contextMenus.create.mock.calls[0];
    expect(props.id).toBe("szuru-grab-element");
    expect(props.title).toBe("Send to szuru");
    // "page" is required: the model is right-clicking the post container,
    // which for a tweet's text area is the page context, not image/link.
    expect(props.contexts).toEqual(["image", "video", "link", "page"]);
  });

  it("creates the menu on Firefox 149+", async () => {
    firefox("149.0");
    const { onInstalled } = await initMenu();

    onInstalled();
    await flush();

    expect(testCtx.browserStub.contextMenus.create).toHaveBeenCalledTimes(1);
  });

  it("does not create the menu below Firefox 149 (openPopup is gesture-gated)", async () => {
    firefox("148.0");
    const { onInstalled } = await initMenu();

    onInstalled();
    await flush();

    // removeAll still runs (clears stale items) but nothing is created: without
    // auto-open there is no way to surface a grab, so the feature stays absent.
    expect(testCtx.browserStub.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(testCtx.browserStub.contextMenus.create).not.toHaveBeenCalled();
  });

  it("restricts the menu to scraped adapter hosts", async () => {
    const { onInstalled } = await initMenu();

    onInstalled();
    await flush();

    const [props] = testCtx.browserStub.contextMenus.create.mock.calls[0];
    const patterns: string[] = props.documentUrlPatterns;
    // A non-exhaustive spot check across the registry (twitter, weibo, pixiv).
    expect(patterns).toContain("*://x.com/*");
    expect(patterns).toContain("*://*.twitter.com/*");
    expect(patterns).toContain("*://*.weibo.com/*");
    expect(patterns).toContain("*://*.pixiv.net/*");
    // And it must not blanket-match the whole web.
    expect(patterns).not.toContain("<all_urls>");
  });

  it("registration failure does not become an unhandled rejection", async () => {
    const { onInstalled } = await initMenu();
    testCtx.browserStub.contextMenus.removeAll.mockRejectedValue(new Error("no permission"));

    expect(() => onInstalled()).not.toThrow();
    await flush();
  });
});

describe("grab dispatch", () => {
  const tab = { id: 42 };

  it("grabs via the content script, stashes and opens the popup", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(grabbedResponse);
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    // Element grab went to the clicked frame.
    expect(testCtx.browserStub.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const [tabId, cmd, options] = testCtx.browserStub.tabs.sendMessage.mock.calls[0];
    expect(tabId).toBe(42);
    expect(cmd.name).toBe("grab_post_element");
    expect(options).toEqual({ frameId: 0 });

    // Stash contract: single slot, grabbedAt + targetUrl + plain ScrapeResults.
    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
    const [stash] = testCtx.browserStub.storage.local.set.mock.calls[0];
    expect(Object.keys(stash)).toEqual(["contextGrabStash"]);
    expect(stash.contextGrabStash.grabbedAt).toEqual(expect.any(Number));
    expect(stash.contextGrabStash.targetUrl).toBe("https://x.com/someone/status/123");
    expect(stash.contextGrabStash.scrapeResults.results[0].engine).toBe("twitter");
    expect(stash.contextGrabStash.scrapeResults.results[0].posts).toHaveLength(1);

    // Success is silent - the auto-opened popup is the feedback.
    expect(testCtx.browserStub.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("passes Firefox's targetElementId through to the content script", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(grabbedResponse);
    const { onClicked } = await initMenu();

    await onClicked(clickInfo({ targetElementId: 7 }), tab);

    const [, cmd] = testCtx.browserStub.tabs.sendMessage.mock.calls[0];
    expect(cmd.data).toEqual({ targetElementId: 7 });
  });

  it("stashes a failure record and still opens the popup when no post was found", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({ status: "no-container" });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
    const [stash] = testCtx.browserStub.storage.local.set.mock.calls[0];
    expect(stash.contextGrabStash.error).toBe("No post found under the right-clicked element.");
    expect(stash.contextGrabStash.scrapeResults).toBeUndefined();
    // The popup claims the failure - open it even on failure.
    expect(testCtx.browserStub.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("stashes a failure record when the content script is unreachable", async () => {
    testCtx.browserStub.tabs.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    const [stash] = testCtx.browserStub.storage.local.set.mock.calls[0];
    expect(stash.contextGrabStash.error).toBe("No post found under the right-clicked element.");
    expect(testCtx.browserStub.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("never stashes zero-post results as success", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({
      status: "ok",
      scrapeResults: { results: [{ engine: "twitter", description: "", posts: [] }] },
    });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    const [stash] = testCtx.browserStub.storage.local.set.mock.calls[0];
    expect(stash.contextGrabStash.error).toBe("No post found under the right-clicked element.");
  });

  it("uses notifications nowhere", async () => {
    testCtx.browserStub.tabs.sendMessage.mockRejectedValue(new Error("down"));
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    // The stub has no notifications namespace at all - any call would have thrown.
    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it("stashes and still opens the popup when openPopup rejects", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(grabbedResponse);
    testCtx.browserStub.action.openPopup.mockRejectedValue(new TypeError("openPopup failed"));
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on other menu items and tabless clicks", async () => {
    await initMenu();

    await testCtx.browserStub.contextMenus.onClicked.addListener.mock.calls.at(-1)![0](
      clickInfo({ menuItemId: "other-extension-item" }),
      tab,
    );
    await testCtx.browserStub.contextMenus.onClicked.addListener.mock.calls.at(-1)![0](clickInfo(), undefined);

    expect(testCtx.browserStub.tabs.sendMessage).not.toHaveBeenCalled();
    expect(testCtx.browserStub.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("menu media CDN hosts", () => {
  it("extends documentUrlPatterns with the tier-A media CDN hosts", async () => {
    const { onInstalled } = await initMenu();

    onInstalled();
    await flush();

    const [props] = testCtx.browserStub.contextMenus.create.mock.calls[0];
    const patterns: string[] = props.documentUrlPatterns;
    // Raw CDN images opened in their own tab must offer the menu so the
    // rewrite tier can handle them.
    expect(patterns).toContain("*://pbs.twimg.com/*");
    expect(patterns).toContain("*://*.sinaimg.cn/*");
    expect(patterns).toContain("*://*.lf127.net/*");
    expect(patterns).toContain("*://cdn.bsky.app/*");
  });
});

describe("rewrite tier (fallback after a failed element grab)", () => {
  const tab = { id: 42 };
  const pbsSrc = "https://pbs.twimg.com/media/abc123?format=jpg&name=small";

  const stash = () => testCtx.browserStub.storage.local.set.mock.calls[0][0].contextGrabStash;

  it("stashes the rewritten post as a success when the element grab finds nothing", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({ status: "no-container" });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo({ srcUrl: pbsSrc }), tab);

    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
    const stashed = stash();
    expect(stashed.error).toBeUndefined();
    expect(stashed.targetUrl).toBe(pbsSrc);
    expect(stashed.scrapeResults.results[0].engine).toBe("twitter");
    expect(stashed.scrapeResults.results[0].posts[0].contentUrl).toBe(pbsSrc.replace("name=small", "name=orig"));
    expect(stashed.scrapeResults.results[0].posts[0].uploadMode).toBe("content");
    expect(testCtx.browserStub.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("serves the rewrite tier when the content script is unreachable (raw CDN tab)", async () => {
    testCtx.browserStub.tabs.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    const { onClicked } = await initMenu();

    // On a pbs.twimg.com tab the page url IS the media url - the rewritten
    // post must not carry it as pageUrl.
    await onClicked(clickInfo({ srcUrl: pbsSrc, pageUrl: pbsSrc }), tab);

    const stashed = stash();
    expect(stashed.error).toBeUndefined();
    expect(stashed.scrapeResults.results[0].posts[0].pageUrl).toBe("");
  });

  it("falls back to linkUrl when no srcUrl is present", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({ status: "no-element" });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo({ linkUrl: "https://wx1.sinaimg.cn/mw2000/abc/def.jpg" }), tab);

    const stashed = stash();
    expect(stashed.error).toBeUndefined();
    expect(stashed.scrapeResults.results[0].engine).toBe("weibo");
    expect(stashed.scrapeResults.results[0].posts[0].contentUrl).toBe("https://wx1.sinaimg.cn/large/abc/def.jpg");
  });

  it("terminates in the failure banner when the target matches no rewrite", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({ status: "unsupported-site" });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo({ srcUrl: "https://example.com/cat.jpg" }), tab);

    const stashed = stash();
    expect(stashed.error).toBe("No post found under the right-clicked element.");
    expect(stashed.scrapeResults).toBeUndefined();
    expect(testCtx.browserStub.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("only runs after a failed element grab, never instead of it", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(grabbedResponse);
    const { onClicked } = await initMenu();

    await onClicked(clickInfo({ srcUrl: pbsSrc }), tab);

    // Element grab ran and won: the stash holds the element's results, and the
    // content script was consulted exactly once.
    expect(testCtx.browserStub.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const stashed = stash();
    expect(stashed.error).toBeUndefined();
    expect(stashed.scrapeResults.results[0].posts[0]).toEqual(grabbedPost);
    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
  });
});
