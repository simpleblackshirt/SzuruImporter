import { hostsToMatchUrl, type SourceUrlFamily } from "./identity";
import type { ContentResolver, ResolvedContent, ResolvablePost, SiteAdapter } from "./index";
import { getErrorMessage } from "~/utils/format";

// Page hosts scraped by the neo-scraper Twitter engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Twitter.ts @ efcea42.
const hosts = ["twitter.com", "mobile.twitter.com", "x.com"];

// The same status is served on x.com and twitter.com with the status id as
// the anchored last path segment.
const sourceFamilies: SourceUrlFamily[] = [{ hosts: ["x.com", "twitter.com"], idPath: /\/status\/[^/]+$/ }];

/**
 * The token twitter's syndication endpoint requires, derived from the status
 * id (scheme verified live 2026-11-20; react-tweet uses the same formula).
 */
export function syndicationTokenForStatus(statusId: string): string {
  return ((Number(statusId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

/** The numeric status id of a post, from its page url / source urls. */
export function statusIdFromPost(post: ResolvablePost): string | undefined {
  for (const url of [post.pageUrl, ...post.source.split("\n")]) {
    const id = url.match(/\/status\/(\d+)/)?.[1];
    if (id) {
      return id;
    }
  }
  return undefined;
}

/** The syndication tweet-result lookup url for a status id. */
export function syndicationUrlForStatus(statusId: string): string {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&token=${syndicationTokenForStatus(statusId)}&lang=en`;
}

interface SyndicationVariant {
  content_type?: string;
  type?: string;
  bitrate?: number;
  src?: string;
  url?: string;
}

/**
 * Best (highest-bitrate) mp4 variant of a syndication tweet-result. Video
 * tweets carry the variants twice: `mediaDetails[].video_info.variants` with
 * bitrates and `video.variants` without - merged here, m3u8 (hls) entries
 * skipped. Undefined for photo tweets.
 */
export function bestMp4VariantFromTweet(tweet: any): { url: string; bitrate: number } | undefined {
  const variants: SyndicationVariant[] = [
    ...(tweet?.mediaDetails ?? []).flatMap((media: any) => media?.video_info?.variants ?? []),
    ...(tweet?.video?.variants ?? []),
  ];

  let best: { url: string; bitrate: number } | undefined;
  for (const variant of variants) {
    const url = variant.src ?? variant.url;
    if (!url || (variant.content_type ?? variant.type) != "video/mp4") {
      continue;
    }
    const bitrate = variant.bitrate ?? 0;
    if (!best || bitrate > best.bitrate) {
      best = { url, bitrate };
    }
  }
  return best;
}

/** Resolution from the variant url path (`.../vid/avc1/720x1280/...`). */
function resolutionFromVariantUrl(url: string): [number, number] | undefined {
  const match = url.match(/\/vid\/[^/]+\/(\d+)x(\d+)\//);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

async function resolveTwitterPost(post: ResolvablePost): Promise<ResolvedContent | undefined> {
  // Only video placeholder posts need resolution: the engine's stubs carry a
  // blob: stream pointer; direct twimg media urls are already uploadable.
  if (post.contentType != "video" || /^https?:\/\/video\.twimg\.com\//.test(post.contentUrl)) {
    return undefined;
  }

  const statusId = statusIdFromPost(post);
  if (!statusId) {
    return undefined;
  }

  const response = await fetch(syndicationUrlForStatus(statusId));
  if (!response.ok) {
    throw new Error(`Twitter syndication lookup for status ${statusId} failed with status ${response.status}.`);
  }
  const tweet = await response.json();

  const best = bestMp4VariantFromTweet(tweet);
  if (!best) {
    // Photo tweet / unavailable post: keep the scraped state.
    return undefined;
  }

  const resolved: ResolvedContent = { contentUrl: best.url };
  resolved.resolution = resolutionFromVariantUrl(best.url);
  if (tweet.possibly_sensitive) {
    resolved.rating = "sketchy";
  }
  return resolved;
}

const twitterContentResolver: ContentResolver = {
  async resolve(posts) {
    return Promise.all(
      posts.map(async (post) => {
        try {
          return await resolveTwitterPost(post);
        } catch (ex) {
          // Surfaced in the popup's error banner: a placeholder post cannot
          // be uploaded, so staying silent would end in a confusing failure
          // at upload time (or an unplayable preview).
          return { error: `Twitter video resolution failed: ${getErrorMessage(ex)}` };
        }
      }),
    );
  },
};

const twitter: SiteAdapter = {
  id: "twitter",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
  sourceFamilies,
  resolveContent: twitterContentResolver,
};

export default twitter;
