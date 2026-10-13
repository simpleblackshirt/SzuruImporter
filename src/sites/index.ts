import weibo from "./weibo";

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
  /** Source-dedup family keys (see ~/utils) applying to this site's source urls. */
  sourceFamilies?: string[];
}

export interface RefererRule {
  /** webRequest listener url filters (match patterns). */
  urlFilter: string[];
  /** Matches the request urls this rule applies to. */
  urlPattern: RegExp;
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

/** All known sites. */
export const siteAdapters: SiteAdapter[] = [weibo];

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
