import { describe, expect, it } from "vitest";
import weibo from "./weibo";

describe("weibo site adapter", () => {
  it("should declare the page hosts of the neo-scraper Weibo engine", () => {
    expect(weibo.hosts).toEqual(["weibo.com", "m.weibo.cn", "weibo.cn", "weibo.com.cn"]);
  });
});

describe("weibo referer rule", () => {
  const rule = weibo.refererRule!;

  it("matches the sinaimg image CDN (existing behavior)", () => {
    expect(rule.urlPattern.test("https://wx4.sinaimg.cn/large/pic1.jpg")).toBe(true);
    expect(rule.requestDomains).toContain("sinaimg.cn");
    expect(rule.urlFilter).toContain("*://*.sinaimg.cn/*");
  });

  it("matches the video CDN including its per-region subdomains", () => {
    expect(rule.urlPattern.test("https://f.video.weibocdn.com/o0/abc.mp4?label=mp4_720p&Expires=1&ssig=x")).toBe(true);
    expect(rule.urlPattern.test("https://video.weibocdn.com/o0/abc.mp4")).toBe(true);
    expect(rule.requestDomains).toContain("video.weibocdn.com");
    expect(rule.urlFilter).toContain("*://*.video.weibocdn.com/*");
    expect(rule.urlFilter).toContain("*://video.weibocdn.com/*");
  });

  it("does not match unrelated hosts", () => {
    expect(rule.urlPattern.test("https://example.com/large/pic.jpg")).toBe(false);
    expect(rule.urlPattern.test("https://weibo.com/somepage")).toBe(false);
    expect(rule.urlPattern.test("https://evil.weibocdn.com.evil.example/abc.mp4")).toBe(false);
  });

  it("attaches the weibo referer only for extension-initiated requests", () => {
    expect(rule.referer).toBe("https://weibo.com/");
    expect(rule.extensionInitiatedOnly).toBe(true);
  });
});

describe("weibo download fallback", () => {
  const fallback = weibo.downloadFallback!;

  it("stays image-only: the mw2000 downgrade does not apply to video urls", () => {
    expect(fallback.urlPattern.test("https://wx4.sinaimg.cn/large/pic1.jpg")).toBe(true);
    expect(fallback.urlPattern.test("https://f.video.weibocdn.com/o0/abc.mp4?label=mp4_720p")).toBe(false);
  });

  it("downgrades large renditions to mw2000", () => {
    expect(fallback.resolve("https://wx4.sinaimg.cn/large/pic1.jpg")).toBe("https://wx4.sinaimg.cn/mw2000/pic1.jpg");
  });
});
