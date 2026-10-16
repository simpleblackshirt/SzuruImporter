import { downgradeSinaImageUrl } from "neo-scraper";
import type { DownloadFallback, RefererRule, SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Weibo engine (its supportedHosts).
const hosts = ["weibo.com", "m.weibo.cn", "weibo.cn", "weibo.com.cn"];

// Weibo's sinaimg CDN returns 403 for image requests without a weibo Referer.
const sinaimgUrlRegex = /^https?:\/\/[^/]*\.sinaimg\.cn\//;

const weibo: SiteAdapter = {
  id: "weibo",
  hosts,
  matchUrl: /^https?:\/\/([^/]+\.)?weibo\.(com|cn|com\.cn)\//,
  refererRule: {
    urlFilter: ["*://*.sinaimg.cn/*"],
    urlPattern: sinaimgUrlRegex,
    requestDomains: ["sinaimg.cn"],
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
