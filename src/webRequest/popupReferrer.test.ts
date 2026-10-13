import { beforeAll, describe, expect, it, vi } from "vitest";

const testCtx = vi.hoisted(() => {
  const addOnBeforeSendHeadersListener = vi.fn();

  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    webRequest: { onBeforeSendHeaders: { addListener: addOnBeforeSendHeadersListener } },
  };

  return { addOnBeforeSendHeadersListener, browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);
// jsdom's user agent is not Chromium; pin the Chromium branch of the extraInfoSpec.
vi.mock("~/env", () => ({ isChrome: true }));

import { registerPopupReferrerListener } from "./popupReferrer";

beforeAll(() => {
  registerPopupReferrerListener(getPostForContentUrl);
});

const getListener = () => {
  expect(testCtx.addOnBeforeSendHeadersListener).toHaveBeenCalledTimes(1);
  return testCtx.addOnBeforeSendHeadersListener.mock.calls[0][0] as (details: any) => any;
};

const getFilter = () => testCtx.addOnBeforeSendHeadersListener.mock.calls[0][1];
const getExtraInfoSpec = () => testCtx.addOnBeforeSendHeadersListener.mock.calls[0][2];

const withReferrerPost = { contentUrl: "https://wx4.sinaimg.cn/mw2000/abcd.jpg", referrer: "https://weibo.com/" };
const withoutReferrerPost = { contentUrl: "https://i.pximg.net/img-master/x.jpg" };

// Stands in for the popup store's getPostForContentUrl action.
const getPostForContentUrl = vi.fn((url: string) => {
  if (url == withReferrerPost.contentUrl) {
    return withReferrerPost;
  }
  if (url == withoutReferrerPost.contentUrl) {
    return withoutReferrerPost;
  }
  return undefined;
});

function details(overrides: Record<string, unknown> = {}) {
  return {
    url: withReferrerPost.contentUrl,
    requestHeaders: [{ name: "User-Agent", value: "Mozilla/5.0" }],
    ...overrides,
  };
}

describe("popup referrer webRequest listener", () => {
  it("should be registered as a blocking listener for all urls with the chromium extraHeaders spec", () => {
    expect(getFilter()).toEqual({ urls: ["<all_urls>"] });
    // Failure mode: without extraHeaders, Chromium hides the Referer header and the push is ignored.
    expect(getExtraInfoSpec()).toEqual(["requestHeaders", "blocking", "extraHeaders"]);
  });

  it("should push the popup post's referrer without removing an existing referer", () => {
    // Failure mode: background-style replace semantics would drop the original header.
    const result = getListener()(
      details({
        requestHeaders: [
          { name: "Referer", value: "https://evil.example.com/" },
          { name: "User-Agent", value: "Mozilla/5.0" },
        ],
      }),
    );

    expect(result.requestHeaders).toEqual([
      { name: "Referer", value: "https://evil.example.com/" },
      { name: "User-Agent", value: "Mozilla/5.0" },
      { name: "Referer", value: "https://weibo.com/" },
    ]);
  });

  it("must not modify requests that match no popup post", () => {
    const result = getListener()(details({ url: "https://example.com/unrelated.jpg" }));

    expect(result.requestHeaders).toEqual([{ name: "User-Agent", value: "Mozilla/5.0" }]);
  });

  it("must not modify requests for popup posts without a referrer", () => {
    const result = getListener()(details({ url: withoutReferrerPost.contentUrl }));

    expect(result.requestHeaders).toEqual([{ name: "User-Agent", value: "Mozilla/5.0" }]);
  });
});
