import { beforeEach, describe, expect, it, vi } from "vitest";

const testCtx = vi.hoisted(() => {
  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    action: { openPopup: vi.fn().mockResolvedValue(undefined) },
    notifications: { create: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  testCtx.browserStub.contextMenus.removeAll.mockResolvedValue(undefined);
  testCtx.browserStub.action.openPopup.mockResolvedValue(undefined);
  testCtx.browserStub.storage.local.set.mockResolvedValue(undefined);
});

describe("menu registration", () => {
  it("removes and creates the menu item on install", async () => {
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

    expect(testCtx.browserStub.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Grabbed for szuru" }),
    );
    expect(testCtx.browserStub.action.openPopup).toHaveBeenCalledTimes(1);
  });

  it("passes Firefox's targetElementId through to the content script", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(grabbedResponse);
    const { onClicked } = await initMenu();

    await onClicked(clickInfo({ targetElementId: 7 }), tab);

    const [, cmd] = testCtx.browserStub.tabs.sendMessage.mock.calls[0];
    expect(cmd.data).toEqual({ targetElementId: 7 });
  });

  it("notifies failure without stashing when no post container was found", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({ status: "no-container" });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    expect(testCtx.browserStub.storage.local.set).not.toHaveBeenCalled();
    expect(testCtx.browserStub.action.openPopup).not.toHaveBeenCalled();
    expect(testCtx.browserStub.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Grab failed" }),
    );
  });

  it("notifies failure without stashing when the content script is unreachable", async () => {
    testCtx.browserStub.tabs.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    expect(testCtx.browserStub.storage.local.set).not.toHaveBeenCalled();
    expect(testCtx.browserStub.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Grab failed" }),
    );
  });

  it("never stashes zero-post results", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue({
      status: "ok",
      scrapeResults: { results: [{ engine: "twitter", description: "", posts: [] }] },
    });
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    expect(testCtx.browserStub.storage.local.set).not.toHaveBeenCalled();
    expect(testCtx.browserStub.action.openPopup).not.toHaveBeenCalled();
  });

  it("stashes and notifies even when openPopup is unavailable", async () => {
    testCtx.browserStub.tabs.sendMessage.mockResolvedValue(grabbedResponse);
    testCtx.browserStub.action.openPopup.mockRejectedValue(new TypeError("openPopup is not a function"));
    const { onClicked } = await initMenu();

    await onClicked(clickInfo(), tab);

    expect(testCtx.browserStub.storage.local.set).toHaveBeenCalledTimes(1);
    expect(testCtx.browserStub.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Grabbed for szuru" }),
    );
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
