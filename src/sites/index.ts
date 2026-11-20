import type { BooruTypes, ContentType, UploadMode } from "neo-scraper";
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
/**
 * A content resolution plan for a grabbed post: the scraped contentUrl is a
 * placeholder that needs background byte-assembly before it can be uploaded.
 * Plain serializable - rides cloneDeep + runtime messaging to the background,
 * which materializes the real bytes inside the upload command.
 */
export type ResolvedContentPlan = {
  /** The real content is an HLS playlist: the background downloads the best
   * variant's segments and transmuxes them into an mp4 blob (bluesky video). */
  kind: "hls-mp4";
  playlistUrl: string;
};

/**
 * What a content resolver decided for one post. Undefined = keep the scraped
 * post as-is. Field-based (not a full replacement) so resolvers only touch
 * what they actually know.
 */
export interface ResolvedContent {
  /** Set when the background must assemble the uploadable bytes (see above). */
  plan?: ResolvedContentPlan;
  /**
   * Resolution failure: the scraped post is kept as-is and the message is
   * shown in the popup's error banner. Carries no other fields - a failed
   * resolution never half-applies.
   */
  error?: string;
  /** Replacement content url (e.g. a resolved mp4 variant url). */
  contentUrl?: string;
  contentType?: ContentType;
  uploadMode?: UploadMode;
  /** Display url for video posts whose contentUrl is not renderable in the
   * popup (a poster image - rendered via <video poster>). */
  previewUrl?: string;
  resolution?: [number, number];
  rating?: BooruTypes.SafetyRating;
}

/** The slice of a post view model resolvers may inspect (plain serializable). */
export interface ResolvablePost {
  id: string;
  contentType: ContentType;
  contentUrl: string;
  pageUrl: string;
  /** The post's joined source urls; the first line is the canonical source. */
  source: string;
}

export interface ContentResolver {
  /** Resolves a batch of posts of one adapter. Returns one entry per input
   * post, in order; undefined keeps the post's scraped state. Individual
   * failures resolve as undefined - one bad post must not sink the batch. */
  resolve(posts: ResolvablePost[]): Promise<(ResolvedContent | undefined)[]>;
}

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
  /** Resolves scraped content that needs API round-trips the DOM-only
   * neo-scraper engines cannot do (twitter mp4 variants, bluesky video). */
  resolveContent?: ContentResolver;
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

/**
 * Runs the adapters' content resolvers over grabbed posts, grouped per site.
 * Resolution failures are logged and leave the affected posts in their
 * scraped state (they surface at upload time, where they belong).
 */
export async function resolveContentForPosts(
  posts: ResolvablePost[],
): Promise<Map<string, ResolvedContent | undefined>> {
  const byAdapter = new Map<SiteAdapter, ResolvablePost[]>();
  for (const post of posts) {
    const adapter = adapterForUrl(post.pageUrl);
    if (adapter?.resolveContent) {
      const group = byAdapter.get(adapter) ?? [];
      group.push(post);
      byAdapter.set(adapter, group);
    }
  }

  const resolved = new Map<string, ResolvedContent | undefined>();
  await Promise.all(
    [...byAdapter.entries()].map(async ([adapter, group]) => {
      try {
        const results = await adapter.resolveContent.resolve(group);
        group.forEach((post, i) => resolved.set(post.id, results[i]));
      } catch (ex) {
        console.error(`Content resolution failed for ${adapter.id}:`, ex);
      }
    }),
  );
  return resolved;
}
