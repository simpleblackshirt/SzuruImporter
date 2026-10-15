import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testCtx = vi.hoisted(() => {
  const addOnBeforeSendHeadersListener = vi.fn();
  const updateSessionRules = vi.fn().mockResolvedValue(undefined);
  // Mutable: empty = the Chromium manifest (webRequestBlocking pruned, DNR
  // path); webRequestBlocking = the gecko manifest (blocking webRequest path).
  const permissions: string[] = [];

  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      getManifest: () => ({ manifest_version: 3, permissions: [...permissions] }),
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    action: { openPopup: vi.fn().mockResolvedValue(undefined) },
    notifications: { onClicked: { addListener: vi.fn() }, create: vi.fn(), clear: vi.fn() },
    tabs: {
      TAB_ID_NONE: -1,
      create: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      executeScript: vi.fn().mockResolvedValue([]),
    },
    webRequest: { onBeforeSendHeaders: { addListener: addOnBeforeSendHeadersListener } },
    declarativeNetRequest: { updateSessionRules },
    webNavigation: { onCommitted: { addListener: vi.fn() } },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    storage: {
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };

  return { addOnBeforeSendHeadersListener, updateSessionRules, permissions, browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

const setPermissions = (...granted: string[]) => {
  testCtx.permissions.splice(0, testCtx.permissions.length, ...granted);
};

const initMain = async () => {
  vi.resetModules();
  await import("./main");
  // Drain the fire-and-forget DNR registration promise.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function details(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://wx4.sinaimg.cn/large/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg",
    requestHeaders: [{ name: "User-Agent", value: "Mozilla/5.0" }],
    ...overrides,
  };
}

describe("Chromium referer mechanism (DNR session rules)", () => {
  beforeAll(async () => {
    setPermissions(); // no webRequestBlocking: the Chromium manifest variant
    testCtx.addOnBeforeSendHeadersListener.mockClear();
    testCtx.updateSessionRules.mockClear();
    await initMain();
  });

  it("registers one modifyHeaders session rule per referer registry entry", () => {
    expect(testCtx.updateSessionRules).toHaveBeenCalledTimes(1);
    const [options] = testCtx.updateSessionRules.mock.calls[0];

    // Failure mode: a static ruleset would silently outlive redesigns - the
    // rules must be session rules removed and re-added on every wake.
    expect(options.removeRuleIds).toEqual([1, 2]);
    // Rules follow the ~/sites registry order (pixiv precedes weibo).
    expect(options.addRules).toEqual([
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "set", value: "https://pixiv.net/" }],
        },
        condition: {
          // TAB_ID_NONE (-1): requests NOT originating from any tab - the
          // extensionInitiatedOnly equivalent (mv3-facts W1).
          tabIds: [-1],
          requestDomains: ["pximg.net"],
          resourceTypes: ["xmlhttprequest", "image", "other"],
        },
      },
      {
        id: 2,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "set", value: "https://weibo.com/" }],
        },
        condition: {
          tabIds: [-1],
          requestDomains: ["sinaimg.cn"],
          resourceTypes: ["xmlhttprequest", "image", "other"],
        },
      },
    ]);
  });

  it("does not register a blocking webRequest listener on the Chromium path", () => {
    expect(testCtx.addOnBeforeSendHeadersListener).not.toHaveBeenCalled();
  });

  it("re-registration after a simulated SW wake stays idempotent", async () => {
    testCtx.updateSessionRules.mockClear();
    await initMain();

    expect(testCtx.updateSessionRules).toHaveBeenCalledTimes(1);
    const [options] = testCtx.updateSessionRules.mock.calls[0];
    expect(options.removeRuleIds).toEqual([1, 2]);
    expect(options.addRules).toHaveLength(2);
  });
});

describe("gecko referer mechanism (blocking webRequest, Firefox-gated)", () => {
  beforeAll(async () => {
    setPermissions("webRequest", "webRequestBlocking");
    testCtx.addOnBeforeSendHeadersListener.mockClear();
    testCtx.updateSessionRules.mockClear();
    await initMain();
  });

  const getListener = () => {
    expect(testCtx.addOnBeforeSendHeadersListener).toHaveBeenCalledTimes(1);
    return testCtx.addOnBeforeSendHeadersListener.mock.calls[0][0] as (details: any) => any;
  };

  const getFilter = () => testCtx.addOnBeforeSendHeadersListener.mock.calls[0][1];
  const getExtraInfoSpec = () => testCtx.addOnBeforeSendHeadersListener.mock.calls[0][2];

  it("auto-revives the blocking listener from the manifest permissions alone (W2 gate assumption)", () => {
    expect(getFilter()).toEqual({ urls: ["*://*.i.pximg.net/*", "*://*.sinaimg.cn/*"] });
    expect(getExtraInfoSpec()).toEqual(["blocking", "requestHeaders"]);
    // The gecko variant must not also register DNR session rules.
    expect(testCtx.updateSessionRules).not.toHaveBeenCalled();
  });

  it("attaches the weibo referer for requests initiated by the extension", () => {
    // Failure mode: without the Referer, sinaimg answers 403 and uploads fail.
    const result = getListener()(details({ originUrl: "moz-extension://test-uuid/dist/popup/index.html" }));

    expect(result.requestHeaders).toEqual([
      { name: "User-Agent", value: "Mozilla/5.0" },
      { name: "Referer", value: "https://weibo.com/" },
    ]);
  });

  it("fires when only the initiator (chromium-style field) marks the extension origin", () => {
    const result = getListener()(details({ initiator: "moz-extension://test-uuid" }));

    expect(result.requestHeaders?.map((h: any) => h.name)).toContain("Referer");
  });

  it("replaces an existing referer to keep the header deterministic", () => {
    const result = getListener()(
      details({
        originUrl: "moz-extension://test-uuid/dist/popup/index.html",
        requestHeaders: [
          { name: "Referer", value: "https://evil.example.com/" },
          { name: "User-Agent", value: "Mozilla/5.0" },
        ],
      }),
    );

    expect(result.requestHeaders).toEqual([
      { name: "User-Agent", value: "Mozilla/5.0" },
      { name: "Referer", value: "https://weibo.com/" },
    ]);
  });

  it("must not modify requests initiated by normal web pages", () => {
    // Failure mode: attaching our Referer to browsing traffic would alter user requests.
    const weiboPage = getListener()(details({ originUrl: "https://weibo.com/u/12345" }));
    const googlePage = getListener()(details({ originUrl: "https://www.google.com/" }));
    const noOrigin = getListener()(details());

    expect(weiboPage).toEqual({});
    expect(googlePage).toEqual({});
    expect(noOrigin).toEqual({});
  });

  it("must not modify non-sinaimg requests even when extension-initiated", () => {
    const result = getListener()(
      details({
        url: "https://szuru.example.org/api/uploads",
        originUrl: "moz-extension://test-uuid/dist/popup/index.html",
      }),
    );

    expect(result).toEqual({});
  });

  it("attaches the pixiv referer for extension-initiated pximg requests", () => {
    // Failure mode: i.pximg.net answers 403 without a pixiv Referer, so
    // downloads of pixiv originals from the extension fail.
    const result = getListener()(
      details({
        url: "https://i.pximg.net/img-original/img/2022/02/15/06/50/28/96268450_p0.jpg",
        originUrl: "moz-extension://test-uuid/dist/popup/index.html",
      }),
    );

    expect(result.requestHeaders).toEqual([
      { name: "User-Agent", value: "Mozilla/5.0" },
      { name: "Referer", value: "https://pixiv.net/" },
    ]);
  });

  it("must not modify pximg requests initiated by normal web pages", () => {
    const result = getListener()(
      details({
        url: "https://i.pximg.net/img-original/img/2022/02/15/06/50/28/96268450_p0.jpg",
        originUrl: "https://www.pixiv.net/en/artworks/96268450",
      }),
    );

    expect(result).toEqual({});
  });
});

describe("notification click routing (cold-start safe)", () => {
  beforeEach(() => {
    testCtx.browserStub.tabs.create.mockClear();
    testCtx.browserStub.notifications.create.mockClear();
    testCtx.browserStub.notifications.clear.mockClear();
  });

  // main.ts registers exactly one notifications.onClicked listener.
  const getNotificationClickHandler = () => {
    const calls = testCtx.browserStub.notifications.onClicked.addListener.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0] as (id: string) => void;
  };

  it("opens upload-result notification ids (http(s) urls) as tabs and clears them", () => {
    getNotificationClickHandler()("https://szuru.example.org/post/123");

    expect(testCtx.browserStub.tabs.create).toHaveBeenCalledWith({ url: "https://szuru.example.org/post/123" });
    expect(testCtx.browserStub.notifications.clear).toHaveBeenCalledWith("https://szuru.example.org/post/123");
  });

  it("ignores extension-internal notification ids instead of opening them as urls", () => {
    // Defensive: only http(s) ids are upload-result notifications pointing at
    // the szurubooru post; anything else must never become a tab.
    getNotificationClickHandler()("internal:1");
    getNotificationClickHandler()("internal-id:2");

    expect(testCtx.browserStub.tabs.create).not.toHaveBeenCalled();
  });
});
