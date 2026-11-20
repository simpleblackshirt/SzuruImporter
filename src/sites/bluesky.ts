import { hostsToMatchUrl } from "./identity";
import type { ContentResolver, ResolvedContent, SiteAdapter } from "./index";
import { getErrorMessage } from "~/utils/format";

// Page hosts scraped by the neo-scraper Bluesky engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Bluesky.ts @ efcea42.
const hosts = ["bsky.app"];

// The public AppView needs no auth for public posts (anonymous calls verified
// 2026-11-20; getPosts caps at 25 uris per request).
const PUBLIC_API = "https://public.api.bsky.app";

/** AT-URI pieces from a bsky.app post permalink (`/profile/<handle>/post/<rkey>`). */
export function atUriPartsFromUrl(url: string): { handle: string; rkey: string } | undefined {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    const match = path.match(/^\/profile\/([^/]+)\/post\/([^/]+)$/);
    return match ? { handle: match[1], rkey: match[2] } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The video embed view of a getPosts post, walking record-with-media nests.
 * Video embed views are `app.bsky.embed.video#view` (quoted videos belong to
 * the quoted post and are never this post's content).
 */
export function videoEmbedView(embed: any): any | undefined {
  if (!embed) {
    return undefined;
  }
  const type: string = embed.$type ?? "";
  if (type.startsWith("app.bsky.embed.video")) {
    return embed;
  }
  if (type.startsWith("app.bsky.embed.recordWithMedia")) {
    return videoEmbedView(embed.media);
  }
  return undefined;
}

async function resolveHandleToDid(handle: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) {
      return undefined;
    }
    return (await res.json()).did;
  } catch {
    return undefined;
  }
}

const blueskyContentResolver: ContentResolver = {
  /**
   * The AppView is the source of truth for video-ness: the DOM only ever
   * shows a video post's poster image, so EVERY bluesky post is classified.
   * Video posts keep their poster as contentUrl (popup preview) and gain a
   * resolution plan - the background downloads + transmuxes the real stream
   * (MPEG-TS HLS, unplayable/uploadable as-is) inside the upload command.
   */
  async resolve(posts) {
    // AT-URI parts per post (permalink page url, falling back to the source).
    const entries = posts.map((post) => ({
      post,
      parts: atUriPartsFromUrl(post.pageUrl) ?? atUriPartsFromUrl(post.source.split("\n")[0] ?? ""),
    }));

    // handles -> dids (deduplicated; a post without one stays unresolved).
    const didByHandle = new Map<string, string>();
    const handles = [...new Set(entries.map((e) => e.parts?.handle).filter((x): x is string => !!x))];
    await Promise.all(
      handles.map(async (handle) => {
        const did = await resolveHandleToDid(handle);
        if (did) {
          didByHandle.set(handle, did);
        }
      }),
    );

    const uriByPostId = new Map<string, string>();
    for (const entry of entries) {
      const did = entry.parts && didByHandle.get(entry.parts.handle);
      if (did) {
        uriByPostId.set(entry.post.id, `at://${did}/app.bsky.feed.post/${entry.parts!.rkey}`);
      }
    }
    if (uriByPostId.size == 0) {
      return posts.map(() => undefined);
    }

    // Batched getPosts: one post-view per uri, then classify. A failure here
    // is flagged on every post: staying silent would leave a video post to be
    // uploaded as its poster image.
    const viewByUri = new Map<string, any>();
    const uris = [...uriByPostId.values()];
    try {
      for (let i = 0; i < uris.length; i += 25) {
        const query = uris.slice(i, i + 25).map((uri) => `uris=${encodeURIComponent(uri)}`).join("&");
        const res = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getPosts?${query}`);
        if (!res.ok) {
          throw new Error(`Bluesky getPosts failed with status ${res.status}.`);
        }
        for (const view of (await res.json()).posts ?? []) {
          viewByUri.set(view.uri, view);
        }
      }
    } catch (ex) {
      return entries.map(() => ({ error: `Bluesky video classification failed: ${getErrorMessage(ex)}` }));
    }

    return entries.map((entry): ResolvedContent | undefined => {
      const uri = uriByPostId.get(entry.post.id);
      const video = videoEmbedView(uri && viewByUri.get(uri)?.embed);
      if (!video?.playlist) {
        // Image post, quoted-only video, or an unavailable post (deleted /
        // logged-out viewing disabled): keep the scraped state.
        return undefined;
      }

      const resolved: ResolvedContent = {
        plan: { kind: "hls-mp4", playlistUrl: video.playlist },
        contentType: "video",
        uploadMode: "content",
        previewUrl: entry.post.contentUrl,
      };
      const aspect = video.aspectRatio;
      if (aspect?.width && aspect?.height) {
        resolved.resolution = [aspect.width, aspect.height];
      }
      return resolved;
    });
  },
};

const bluesky: SiteAdapter = {
  id: "bluesky",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
  resolveContent: blueskyContentResolver,
};

export default bluesky;
