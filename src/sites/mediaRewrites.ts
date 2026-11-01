import {
  ScrapeResult,
  ScrapeResults,
  ScrapedPost,
  getOriginalImageUrlFromUrl,
  upgradeSinaImageUrl,
  upgradeToOriginalQuality,
} from "neo-scraper";
import { adapterForUrl } from "./index";

/**
 * Fallback tier-1: media-URL rewrite resolvers for raw CDN media urls.
 * Reached from two grab paths that both hit a CDN url with no post
 * container in the DOM: the background's context-menu tier (element grab
 * found nothing but the click carried info.srcUrl/linkUrl) and the content
 * script's document grab on a raw CDN image opened in its own tab. Pure URL
 * transforms, no network: each resolver produces ONE metadata-less post (a
 * CDN URL carries no artist/tags), matching the engine whose scrape- URL
 * space it belongs to. Nothing matching -> undefined, which leaves the grab
 * to the caller's own fallback.
 */

/** True when hostname is `host` itself or any subdomain of it. */
function hostMatches(hostname: string, host: string): boolean {
  return hostname == host || hostname.endsWith(`.${host}`);
}

/**
 * The post's page url, but only when the grab happened ON the site itself
 * (element-tier fallback). On a raw CDN tab the page url IS the media url -
 * carrying that as pageUrl/source would be noise, so it stays empty.
 */
function pageUrlForSite(pageUrl: string, siteId: string): string {
  return adapterForUrl(pageUrl)?.id == siteId ? pageUrl : "";
}

function resultFor(engine: string, post: ScrapedPost): ScrapeResults {
  const result = new ScrapeResult(engine);
  result.tryAddPost(post);
  const results = new ScrapeResults();
  results.results.push(result);
  return results;
}

function twitterRewrite(url: URL, pageUrl: string): ScrapedPost | undefined {
  if (url.hostname != "pbs.twimg.com" || !url.pathname.startsWith("/media/")) {
    return undefined;
  }
  const post = new ScrapedPost();
  post.contentUrl = getOriginalImageUrlFromUrl(url.href);
  // pbs 403s szuru-server-side fetches, same as element grabs.
  post.uploadMode = "content";
  post.pageUrl = pageUrlForSite(pageUrl, "twitter");
  return post;
}

function weiboRewrite(url: URL, pageUrl: string): ScrapedPost | undefined {
  if (!hostMatches(url.hostname, "sinaimg.cn") || url.pathname.length <= 1) {
    return undefined;
  }
  const post = new ScrapedPost();
  post.contentUrl = upgradeSinaImageUrl(url.href);
  // sinaimg 403s requests without a weibo referer, same as element grabs.
  post.uploadMode = "content";
  post.pageUrl = pageUrlForSite(pageUrl, "weibo");
  return post;
}

function lofterRewrite(url: URL, pageUrl: string): ScrapedPost | undefined {
  if (!hostMatches(url.hostname, "lf127.net")) {
    return undefined;
  }
  const post = new ScrapedPost();
  post.contentUrl = upgradeToOriginalQuality(url.href);
  // Default url mode: no known lofter hotlink protection.
  post.pageUrl = pageUrlForSite(pageUrl, "lofter");
  return post;
}

function blueskyRewrite(url: URL, pageUrl: string): ScrapedPost | undefined {
  if (url.hostname != "cdn.bsky.app" || !url.pathname.includes("/feed_thumbnail/")) {
    return undefined;
  }
  const post = new ScrapedPost();
  post.contentUrl = url.href.replace("/feed_thumbnail/", "/feed_fullsize/");
  post.pageUrl = pageUrlForSite(pageUrl, "bluesky");
  return post;
}

const rewrites: Array<{ engine: string; rewrite: (url: URL, pageUrl: string) => ScrapedPost | undefined }> = [
  { engine: "twitter", rewrite: twitterRewrite },
  { engine: "weibo", rewrite: weiboRewrite },
  { engine: "lofter", rewrite: lofterRewrite },
  { engine: "bluesky", rewrite: blueskyRewrite },
];

/**
 * Runs the rewrite tier against a clicked media URL. Returns a single-result
 * ScrapeResults (engine = site id, one post) or undefined when the URL is not
 * a rewriteable tier-A CDN media URL.
 */
export function rewriteMediaUrl(url: string | undefined, pageUrl: string): ScrapeResults | undefined {
  if (!url) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  for (const { engine, rewrite } of rewrites) {
    const post = rewrite(parsed, pageUrl);
    if (post) {
      // Engine names match the neo-scraper engines, so the popup's
      // "[<engine>] Post n" labels stay consistent across grab paths.
      return resultFor(engine, post);
    }
  }
  return undefined;
}
