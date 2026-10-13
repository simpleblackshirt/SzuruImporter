import { describe, expect, it } from "vitest";
import { adapterForUrl, downloadFallbackForUrl, refererRules, siteAdapters, sourceUrlFamilies } from "./index";
import twitter from "./twitter";
import weibo from "./weibo";
import xiaohongshu from "./xiaohongshu";

describe("site registry", () => {
  const adapters = [weibo, twitter, xiaohongshu];

  it("should register the site adapters in registry order", () => {
    expect(siteAdapters.map((x) => x.id)).toEqual(["weibo", "twitter", "xiaohongshu"]);
  });

  it("should resolve each adapter for page urls on every supported host", () => {
    for (const adapter of adapters) {
      for (const host of adapter.hosts) {
        expect(adapterForUrl(`https://${host}/u/123/abc`)).toBe(adapter);
        expect(adapterForUrl(`https://www.${host}/u/123/abc`)).toBe(adapter);
      }
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

  it("should aggregate the source url families of all adapters in registry order", () => {
    expect(sourceUrlFamilies).toEqual(adapters.flatMap((adapter) => adapter.sourceFamilies ?? []));
  });
});
