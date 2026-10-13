import { beforeAll, describe, expect, it, vi } from "vitest";

const testCtx = vi.hoisted(() => {
  const addOnBeforeSendHeadersListener = vi.fn();

  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    notifications: { onClicked: { addListener: vi.fn() }, create: vi.fn() },
    tabs: { create: vi.fn(), executeScript: vi.fn().mockResolvedValue([]) },
    webRequest: { onBeforeSendHeaders: { addListener: addOnBeforeSendHeadersListener } },
    webNavigation: { onCommitted: { addListener: vi.fn() } },
  };

  return { addOnBeforeSendHeadersListener, browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);
vi.mock("/@vite/client", () => ({ createHotContext: () => ({ data: {}, accept: vi.fn() }) }));

beforeAll(async () => {
  await import("./main");
});

const getListener = () => {
  expect(testCtx.addOnBeforeSendHeadersListener).toHaveBeenCalledTimes(1);
  return testCtx.addOnBeforeSendHeadersListener.mock.calls[0][0] as (details: any) => any;
};

const getFilter = () => testCtx.addOnBeforeSendHeadersListener.mock.calls[0][1];
const getExtraInfoSpec = () => testCtx.addOnBeforeSendHeadersListener.mock.calls[0][2];

function details(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://wx4.sinaimg.cn/large/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg",
    requestHeaders: [{ name: "User-Agent", value: "Mozilla/5.0" }],
    ...overrides,
  };
}

describe("sinaimg Referer webRequest rule", () => {
  it("should be registered as blocking listener for sinaimg urls only", () => {
    expect(getFilter()).toEqual({ urls: ["*://*.sinaimg.cn/*"] });
    expect(getExtraInfoSpec()).toEqual(["blocking", "requestHeaders"]);
  });

  it("should attach the weibo referer for requests initiated by the extension", () => {
    // Failure mode: without the Referer, sinaimg answers 403 and uploads fail.
    const result = getListener()(details({ originUrl: "moz-extension://test-uuid/dist/popup/index.html" }));

    expect(result.requestHeaders).toEqual([
      { name: "User-Agent", value: "Mozilla/5.0" },
      { name: "Referer", value: "https://weibo.com/" },
    ]);
  });

  it("should fire when only the initiator (chromium-style field) marks the extension origin", () => {
    const result = getListener()(details({ initiator: "moz-extension://test-uuid" }));

    expect(result.requestHeaders?.map((h: any) => h.name)).toContain("Referer");
  });

  it("should replace an existing referer to keep the header deterministic", () => {
    const result = getListener()(
      details({
        originUrl: "moz-extension://test-uuid/dist/background/index.html",
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
});
