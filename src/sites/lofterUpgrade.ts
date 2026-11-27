import type { ScrapeResults } from "neo-scraper";

/**
 * Post-grab normalization for lofter: unify grab-surface renditions with the
 * post's permalink page.
 *
 * The tag timeline's cards resolve to the feed rendition of each image, while
 * the permalink page serves the large rendition - a different stored object
 * with different bytes and content-type (object metadata is set per
 * rendition), so grabbing the same post from both surfaces yields two booru
 * posts. The neo-scraper engine already resolves multi-image cards to the
 * large rendition via the gallery `large` attribute; single-image cards have
 * no such reference, so their content urls stay feed renditions.
 *
 * This pass fetches the post's permalink page and adopts its bigimgsrc
 * rendition urls where the mapping is unambiguous: 1 post <-> 1 bigimgsrc,
 * or equal counts (positional - both orders derive from the same post data).
 * Anything ambiguous or unreachable (login wall, theme without bigimgsrc,
 * count mismatch) keeps the scraped url - never worse than the raw grab.
 */

/** CDN hosts pattern mirrored from the neo-scraper Lofter engine. */
const LOFTER_CDN_RE = /(\.lf127\.net|\.127\.net|imglf)/;

/** Lofter's image-processing query (stripped to reach the stored rendition). */
const PROCESSING_QUERY_RE = /imageView|thumbnail|quality|stripmeta/;

/** Feed renditions end in an image extension; the permalink page's
 * bigimgsrc may or may not (depending on the theme) - the extension says
 * nothing about which object is served, only that this grab came from a
 * surface embedding the feed rendition. */
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;

type UpgradeablePost = {
  contentUrl?: string;
  pageUrl?: string;
  sources?: string[];
};

function stripProcessingQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  if (queryIndex != -1 && PROCESSING_QUERY_RE.test(url.slice(queryIndex))) {
    return url.slice(0, queryIndex);
  }
  return url;
}

/**
 * The bigimgsrc renditions of a themed post page, in document order:
 * query-stripped CDN urls. bigimgsrc is emitted by lofter's photo-post
 * templates and is exactly what a permalink grab resolves to, so these are
 * the urls the grab surfaces must agree on.
 */
export function bigimgsrcUrlsFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls: string[] = [];
  for (const anchor of Array.from(doc.querySelectorAll("a[bigimgsrc]"))) {
    const value = anchor.getAttribute("bigimgsrc") ?? "";
    if (!LOFTER_CDN_RE.test(value)) {
      continue;
    }
    const stripped = stripProcessingQuery(value);
    if (stripped && !urls.includes(stripped)) {
      urls.push(stripped);
    }
  }
  return urls;
}

/** The post permalink from sources/pageUrl (lofter.com host, /post/ path). */
function postPermalink(post: UpgradeablePost): string | undefined {
  for (const candidate of [post.sources?.[0], post.pageUrl]) {
    if (!candidate) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (url.hostname.endsWith("lofter.com") && url.pathname.includes("/post/")) {
        return url.origin + url.pathname;
      }
    } catch {
      // relative or malformed - try the next candidate
    }
  }
  return undefined;
}

function isRenditionUrl(contentUrl: string): boolean {
  try {
    return IMAGE_EXT_RE.test(new URL(contentUrl).pathname);
  } catch {
    return false;
  }
}

function swapContentUrl(post: UpgradeablePost, url: string): boolean {
  if (post.contentUrl == url) {
    return false;
  }
  post.contentUrl = url;
  return true;
}

/**
 * Rewrites lofter feed-rendition content urls to their permalink page's
 * bigimgsrc renditions, in place. Returns the number of urls changed. One
 * fetch per distinct permalink serves every post of a multi-image card.
 */
export async function upgradeLofterPosts(
  results: ScrapeResults,
  fetchHtml: (permalink: string) => Promise<string | null>,
): Promise<number> {
  const postsByPermalink = new Map<string, UpgradeablePost[]>();
  for (const result of results.results) {
    if (result.engine != "lofter") {
      continue;
    }
    for (const post of result.posts) {
      if (!post.contentUrl || !isRenditionUrl(post.contentUrl)) {
        continue;
      }
      const permalink = postPermalink(post);
      if (!permalink) {
        // Viewer-overlay content-only grabs and CDN-tab rewrites have no
        // post page to consult.
        continue;
      }
      const group = postsByPermalink.get(permalink) ?? [];
      group.push(post);
      postsByPermalink.set(permalink, group);
    }
  }

  let upgraded = 0;
  const renditionsByPermalink = new Map<string, string[] | null>();
  for (const [permalink, posts] of postsByPermalink) {
    if (!renditionsByPermalink.has(permalink)) {
      let renditions: string[] | null = null;
      try {
        const html = await fetchHtml(permalink);
        renditions = html ? bigimgsrcUrlsFromHtml(html) : null;
      } catch (ex) {
        console.error(`lofterUpgrade: fetching ${permalink} failed:`, ex);
      }
      renditionsByPermalink.set(permalink, renditions);
    }

    const renditions = renditionsByPermalink.get(permalink);
    if (!renditions) {
      continue;
    }
    if (posts.length == 1 && renditions.length == 1) {
      upgraded += swapContentUrl(posts[0], renditions[0]) ? 1 : 0;
    } else if (posts.length == renditions.length) {
      posts.forEach((post, index) => {
        upgraded += swapContentUrl(post, renditions[index]) ? 1 : 0;
      });
    }
    // Mismatched counts stay untouched: pairing would be guesswork, and a
    // wrong pairing silently mislabels images.
  }
  return upgraded;
}

/**
 * Popup-context permalink fetcher. Extension pages fetch cross-origin under
 * host permissions; `credentials: "include"` carries the user's lofter
 * session (plain fetch omits cookies on cross-origin requests), so
 * login-walled permalinks render for the session the user grabbed with.
 * Logged-out fetches get a login page whose missing bigimgsrc anchors fall
 * back to the scraped urls.
 */
export async function fetchLofterPermalinkHtml(permalink: string): Promise<string | null> {
  const res = await fetch(permalink, {
    credentials: "include",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    return null;
  }
  const type = res.headers.get("Content-Type") ?? "";
  if (type.split(";")[0].trim() != "text/html") {
    return null;
  }
  return res.text();
}
