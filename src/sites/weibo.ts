import type { DownloadFallback, RefererRule, SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Weibo engine (its supportedHosts).
const hosts = ["weibo.com", "m.weibo.cn", "weibo.cn", "weibo.com.cn"];

// Weibo's sinaimg CDN returns 403 for image requests without a weibo Referer.
const sinaimgUrlRegex = /^https?:\/\/[^/]*\.sinaimg\.cn\//;

/**
 * Weibo's sinaimg CDN serves image renditions via the first path segment
 * (e.g. /large/, /mw2000/) using the same pic id and file extension.
 */

/**
 * Returns the /mw2000/ fallback url for a /large/ sinaimg url.
 * Returns the input url unchanged if it is not a /large/ sinaimg url.
 */
export function getSinaimgFallbackUrl(contentUrl: string): string {
  if (!/^https?:\/\/[^/]*\.sinaimg\.cn\/large\//.test(contentUrl)) {
    return contentUrl;
  }

  return contentUrl.replace("/large/", "/mw2000/");
}

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
    resolve: getSinaimgFallbackUrl,
  } satisfies DownloadFallback,
};

export default weibo;
