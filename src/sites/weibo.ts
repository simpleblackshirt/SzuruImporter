import { downgradeSinaImageUrl } from "neo-scraper";
import type { DownloadFallback, RefererRule, SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Weibo engine (its supportedHosts).
const hosts = ["weibo.com", "m.weibo.cn", "weibo.cn", "weibo.com.cn"];

// Weibo's media CDNs 403 requests without a weibo Referer: the sinaimg image
// CDN always, and video.weibocdn.com as insurance (its signed video urls
// primarily fail by short TTL, but the referer costs nothing).
const weiboMediaUrlRegex = /^https?:\/\/([^/]*\.sinaimg\.cn|([^/]+\.)?video\.weibocdn\.com)\//;

// The image-only downgrade fallback: video urls have no smaller rendition
// (a stale signed video url simply 403s - re-grab the post).
const sinaimgUrlRegex = /^https?:\/\/[^/]*\.sinaimg\.cn\//;

const weibo: SiteAdapter = {
  id: "weibo",
  hosts,
  matchUrl: /^https?:\/\/([^/]+\.)?weibo\.(com|cn|com\.cn)\//,
  refererRule: {
    urlFilter: ["*://*.sinaimg.cn/*", "*://*.video.weibocdn.com/*", "*://video.weibocdn.com/*"],
    urlPattern: weiboMediaUrlRegex,
    requestDomains: ["sinaimg.cn", "video.weibocdn.com"],
    referer: "https://weibo.com/",
    // Attach the Referer only for requests initiated by our own extension
    // pages (background/popup) - never for requests from normal web browsing.
    extensionInitiatedOnly: true,
  } satisfies RefererRule,
  downloadFallback: {
    urlPattern: sinaimgUrlRegex,
    // neo-scraper's downgradeSinaImageUrl (/large/ -> /mw2000/), the inverse
    // of the engine's scrape-time upgradeSinaImageUrl (renditions -> /large/).
    resolve: downgradeSinaImageUrl,
  } satisfies DownloadFallback,
};

export default weibo;
