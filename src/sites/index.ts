import type { SourceUrlFamily } from "./identity";
import animePictures from "./anime-pictures";
import bluesky from "./bluesky";
import danbooru from "./danbooru";
import e621 from "./e621";
import ehentai from "./ehentai";
import furaffinity from "./furaffinity";
import gelbooru from "./gelbooru";
import inkbunny from "./inkbunny";
import lofter from "./lofter";
import moebooru from "./moebooru";
import nozomi from "./nozomi";
import philomena from "./philomena";
import pixiv from "./pixiv";
import reddit from "./reddit";
import rule34us from "./rule34us";
import sankakuComplex from "./sankaku-complex";
import shimmie2 from "./shimmie2";
import shuushuu from "./shuushuu";
import twitter from "./twitter";
import weibo from "./weibo";
import xiaohongshu from "./xiaohongshu";
import zerochan from "./zerochan";

/**
 * A site adapter bundles the site-specific behavior (scraped hosts,
 * hotlink-protected CDN workarounds, source url families) that would
 * otherwise be scattered over api, background and utils.
 */
export interface SiteAdapter {
  /** Stable identifier, e.g. used as the post's instanceSpecificData key. */
  id: string;
  /** Page hosts scraped by this site's neo-scraper engines. */
  hosts: string[];
  /** Matches page urls belonging to this site. */
  matchUrl: RegExp;
  /** Referer rule for hotlink-protected media CDNs. */
  refererRule?: RefererRule;
  /** Download fallback for media served in downsized renditions. */
  downloadFallback?: DownloadFallback;
  /** Source-dedup url families (see ~/utils) applying to this site's source urls. */
  sourceFamilies?: SourceUrlFamily[];
}

export interface RefererRule {
  /** webRequest listener url filters (match patterns, Firefox path). */
  urlFilter: string[];
  /** Matches the request urls this rule applies to. */
  urlPattern: RegExp;
  /** Registrable domains for DNR requestDomains (Chromium path; matches subdomains too). */
  requestDomains: string[];
  /** Referer header value attached to matching requests. */
  referer: string;
  /** Attach the Referer only to requests initiated by our own extension pages. */
  extensionInitiatedOnly: boolean;
}

export interface DownloadFallback {
  /** Matches content urls this fallback applies to. */
  urlPattern: RegExp;
  /** Returns the fallback url, unchanged when the content url has no fallback variant. */
  resolve: (contentUrl: string) => string;
}

/** All known sites, one per neo-scraper default engine, in engine order. */
export const siteAdapters: SiteAdapter[] = [
  animePictures,
  bluesky,
  danbooru,
  e621,
  ehentai,
  furaffinity,
  gelbooru,
  inkbunny,
  lofter,
  moebooru,
  nozomi,
  philomena,
  pixiv,
  reddit,
  rule34us,
  sankakuComplex,
  shimmie2,
  shuushuu,
  twitter,
  weibo,
  xiaohongshu,
  zerochan,
];

/** Source-url families of all sites, in registry order. */
export const sourceUrlFamilies: SourceUrlFamily[] = siteAdapters.flatMap((adapter) => adapter.sourceFamilies ?? []);

/** Returns the adapter whose matchUrl matches the given page url. */
export function adapterForUrl(url: string): SiteAdapter | undefined {
  return siteAdapters.find((adapter) => adapter.matchUrl.test(url));
}

/** Returns the download fallback resolver applying to the given content url. */
export function downloadFallbackForUrl(contentUrl: string): DownloadFallback["resolve"] | undefined {
  const adapter = siteAdapters.find((x) => x.downloadFallback?.urlPattern.test(contentUrl));
  return adapter?.downloadFallback?.resolve;
}

/** Referer rules of all sites, in registry order. */
export const refererRules: RefererRule[] = siteAdapters.flatMap((adapter) =>
  adapter.refererRule ? [adapter.refererRule] : [],
);
