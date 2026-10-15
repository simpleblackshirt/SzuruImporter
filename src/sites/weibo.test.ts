import { describe, expect, it } from "vitest";
import weibo, { getSinaimgFallbackUrl } from "./weibo";

describe("getSinaimgFallbackUrl", () => {
  it("should swap the large rendition segment for mw2000 keeping pic id and extension", () => {
    expect(getSinaimgFallbackUrl("https://wx4.sinaimg.cn/large/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg")).toBe(
      "https://wx4.sinaimg.cn/mw2000/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg",
    );
  });

  it("should leave non-large sinaimg urls unchanged so no pointless retry happens", () => {
    const url = "https://wx4.sinaimg.cn/mw2000/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg";
    expect(getSinaimgFallbackUrl(url)).toBe(url);
  });

  it("should leave non-sinaimg urls unchanged", () => {
    const url = "https://cdn.example.com/large/pic.jpg";
    expect(getSinaimgFallbackUrl(url)).toBe(url);
  });
});

describe("weibo site adapter", () => {
  it("should declare the page hosts of the neo-scraper Weibo engine", () => {
    expect(weibo.hosts).toEqual(["weibo.com", "m.weibo.cn", "weibo.cn", "weibo.com.cn"]);
  });

  it("should carry the sinaimg referer rule scoped to extension-initiated requests", () => {
    // requestDomains feeds the Chromium DNR session rules (subdomains included);
    // urlFilter remains the Firefox blocking-webRequest filter.
    expect(weibo.refererRule).toEqual({
      urlFilter: ["*://*.sinaimg.cn/*"],
      urlPattern: expect.any(RegExp),
      requestDomains: ["sinaimg.cn"],
      referer: "https://weibo.com/",
      extensionInitiatedOnly: true,
    });
    expect(weibo.refererRule?.urlPattern.test("https://wx4.sinaimg.cn/large/pic.jpg")).toBe(true);
    expect(weibo.refererRule?.urlPattern.test("https://szuru.example.org/api/uploads")).toBe(false);
  });

  it("should carry the sinaimg download fallback resolver", () => {
    expect(weibo.downloadFallback?.resolve("https://wx4.sinaimg.cn/large/pic.jpg")).toBe(
      "https://wx4.sinaimg.cn/mw2000/pic.jpg",
    );
    expect(weibo.downloadFallback?.urlPattern.test("https://cdn.example.com/large/pic.jpg")).toBe(false);
  });
});
