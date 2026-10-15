import { describe, expect, it } from "vitest";
import { adapterForUrl, downloadFallbackForUrl, refererRules, siteAdapters, sourceUrlFamilies } from "./index";
import pixiv from "./pixiv";
import twitter from "./twitter";
import weibo from "./weibo";
import xiaohongshu from "./xiaohongshu";

// One adapter per neo-scraper default engine, in NeoScraper.ts constructor order.
const expectedIds = [
  "anime-pictures",
  "bluesky",
  "danbooru",
  "e621",
  "ehentai",
  "furaffinity",
  "gelbooru",
  "inkbunny",
  "lofter",
  "moebooru",
  "nozomi",
  "philomena",
  "pixiv",
  "reddit",
  "rule34us",
  "sankaku-complex",
  "shimmie2",
  "shuushuu",
  "twitter",
  "weibo",
  "xiaohongshu",
  "zerochan",
];

describe("site registry", () => {
  it("should register one adapter per neo-scraper default engine in engine order", () => {
    expect(siteAdapters.map((x) => x.id)).toEqual(expectedIds);
  });

  it("should resolve each adapter for page urls on every supported host", () => {
    for (const adapter of siteAdapters) {
      for (const host of adapter.hosts) {
        expect(adapterForUrl(`https://${host}/u/123/abc`)).toBe(adapter);
        expect(adapterForUrl(`https://www.${host}/u/123/abc`)).toBe(adapter);
      }
    }
  });

  it("must not resolve an adapter for lookalike or foreign page urls", () => {
    // Failure mode: unescaped dots in derived matchers would turn host lists
    // into wildcards matching lookalike host names.
    for (const adapter of siteAdapters) {
      const lookalike = `https://${adapter.hosts[0].replace(/\./g, "")}.example/u/1`;
      expect(adapterForUrl(lookalike)).toBeUndefined();
    }
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

  it("should expose the sinaimg and pximg referer rules in registry order", () => {
    expect(refererRules).toEqual([pixiv.refererRule, weibo.refererRule]);
    expect(refererRules.map((x) => x.urlFilter)).toEqual([["*://*.i.pximg.net/*"], ["*://*.sinaimg.cn/*"]]);
  });

  it("should scope the pximg referer rule to the pixiv cdn", () => {
    // Failure mode: a wildcard host pattern would rewrite Referers for
    // lookalike hosts, and a web-page-initiated rule would alter user traffic.
    const rule = pixiv.refererRule!;
    expect(rule.referer).toBe("https://pixiv.net/");
    expect(rule.extensionInitiatedOnly).toBe(true);
    expect(rule.urlPattern.test("https://i.pximg.net/img-original/img/2022/02/15/06/50/28/96268450_p0.jpg")).toBe(true);
    expect(rule.urlPattern.test("https://pximg.net.evil.example/img.png")).toBe(false);
  });

  it("should aggregate the source url families of all adapters in registry order", () => {
    expect(sourceUrlFamilies).toEqual([...twitter.sourceFamilies ?? [], ...xiaohongshu.sourceFamilies ?? []]);
  });
});
