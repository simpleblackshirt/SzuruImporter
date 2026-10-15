import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testCtx = vi.hoisted(() => {
  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      getManifest: () => ({ manifest_version: 3, permissions: ["webNavigation", "scripting"] }),
    },
    webNavigation: { onCommitted: { addListener: vi.fn() } },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    tabs: { executeScript: vi.fn() },
  };

  return { browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

beforeAll(async () => {
  await import("./contentScriptHMR");
});

beforeEach(() => {
  testCtx.browserStub.scripting.executeScript.mockClear();
  testCtx.browserStub.tabs.executeScript.mockClear();
});

const getListener = () => {
  expect(testCtx.browserStub.webNavigation.onCommitted.addListener).toHaveBeenCalledTimes(1);
  return testCtx.browserStub.webNavigation.onCommitted.addListener.mock.calls[0][0] as (details: any) => void;
};

describe("dev content script injection", () => {
  it("should inject via browser.scripting.executeScript into the navigated tab", () => {
    // mv3-facts W1: tabs.executeScript is MV2-only on both browsers.
    getListener()({ tabId: 42, frameId: 0, url: "https://weibo.com/u/123" });

    expect(testCtx.browserStub.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42 },
        files: ["dist/contentScripts/index.global.js"],
      }),
    );
  });

  it("must not use the MV2-only tabs.executeScript", () => {
    getListener()({ tabId: 7, frameId: 0, url: "https://example.com/" });

    expect(testCtx.browserStub.tabs.executeScript).not.toHaveBeenCalled();
  });

  it("must not inject into non-main frames", () => {
    getListener()({ tabId: 7, frameId: 2, url: "https://example.com/" });

    expect(testCtx.browserStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("must not inject into browser-internal pages", () => {
    getListener()({ tabId: 7, frameId: 0, url: "chrome://extensions/" });

    expect(testCtx.browserStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("must not inject into extension pages", () => {
    // Failure mode: Firefox 149+ removes moz-extension:// injection targets entirely.
    getListener()({ tabId: 7, frameId: 0, url: "moz-extension://test-uuid/dist/options/index.html" });

    expect(testCtx.browserStub.scripting.executeScript).not.toHaveBeenCalled();
  });
});
