import { describe, expect, it } from "vitest";
import { adapterForUrl, downloadFallbackForUrl, refererRules, siteAdapters } from "./index";
import weibo from "./weibo";

describe("site registry", () => {
  it("should resolve the weibo adapter for weibo page urls on every supported host", () => {
    expect(siteAdapters.map((x) => x.id)).toEqual(["weibo"]);

    for (const host of weibo.hosts) {
      expect(adapterForUrl(`https://${host}/u/123/abc`)).toBe(weibo);
    }
  });

  it("must not resolve an adapter for foreign page urls", () => {
    expect(adapterForUrl("https://example.com/some/post")).toBeUndefined();
    expect(adapterForUrl("https://notweibo.com/some/post")).toBeUndefined();
  });

  it("should resolve the fallback resolver for sinaimg content urls", () => {
    const resolve = downloadFallbackForUrl("https://wx4.sinaimg.cn/large/pic.jpg");

    expect(resolve?.("https://wx4.sinaimg.cn/large/pic.jpg")).toBe("https://wx4.sinaimg.cn/mw2000/pic.jpg");
  });

  it("must not resolve a fallback resolver for foreign content urls", () => {
    expect(downloadFallbackForUrl("https://cdn.example.com/large/pic.jpg")).toBeUndefined();
  });

  it("should expose exactly one referer rule, scoped to the sinaimg cdn", () => {
    expect(refererRules).toEqual([weibo.refererRule]);
    expect(refererRules[0].urlFilter).toEqual(["*://*.sinaimg.cn/*"]);
  });
});
