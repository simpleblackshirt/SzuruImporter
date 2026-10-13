import { sourceUrlFamilies } from "~/sites";
import { LOCALE_PATH_SEGMENTS, samePostInFamily } from "~/sites/identity";

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function stripWww(host: string): string {
  return host.replace(/^www\./, "");
}

/**
 * Normalizes a url for dedup comparison: lowercases the host, strips a leading
 * "www.", strips hash and query, drops a locale path segment directly after the
 * host and trims trailing slashes. Returns the input unchanged if it is not a
 * parsable absolute url.
 */
export function normalizeSourceUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) return url;

  const host = stripWww(parsed.hostname.toLowerCase());
  const segments = parsed.pathname.split("/").filter((s) => s != "");
  // Only strip a locale in front of other segments; "/en" alone might be a real page.
  if (segments.length > 1 && LOCALE_PATH_SEGMENTS.has(segments[0].toLowerCase())) {
    segments.shift();
  }
  return segments.length > 0 ? `${host}/${segments.join("/")}` : host;
}

/**
 * Returns true if both urls refer to the same post: either they normalize to the
 * same url, or their hosts belong to the same site family, both urls carry the
 * post id as their last path segment and those ids match.
 */
export function urlsReferToSamePost(urlA: string, urlB: string): boolean {
  if (normalizeSourceUrl(urlA) == normalizeSourceUrl(urlB)) return true;

  const parsedA = parseUrl(urlA);
  const parsedB = parseUrl(urlB);
  if (!parsedA || !parsedB) return false;

  const hostA = stripWww(parsedA.hostname.toLowerCase());
  const hostB = stripWww(parsedB.hostname.toLowerCase());
  const pathA = parsedA.pathname;
  const pathB = parsedB.pathname;

  return sourceUrlFamilies.some((family) => samePostInFamily(family, hostA, pathA, hostB, pathB));
}

/**
 * Appends the page url to the source field if wanted, unless the source already
 * refers to the same post: engines often already emit the page url as source,
 * possibly in another locale/host/query variant.
 * The dedup check always runs, only appending is governed by addPageUrlToSource.
 */
export function appendPageUrlToSource(source: string, pageUrl: string, addPageUrlToSource?: boolean): string {
  if (source.split("\n").some((line) => urlsReferToSamePost(line, pageUrl))) return source;

  if (addPageUrlToSource || source == "") {
    if (source != "") source += "\n";
    source += pageUrl;
  }
  return source;
}

/**
 * Merges the scraped source lines into the existing source, skipping lines that
 * already refer to the same post (see urlsReferToSamePost), so form variants of
 * an existing source (other locale/host/query) never produce duplicates.
 */
export function mergeSources(existingSource: string | undefined, scrapedSource: string): string {
  const existingLines = existingSource?.split(/\r?\n/) ?? [];
  const lines = [...existingLines];
  for (const line of scrapedSource.split(/\r?\n/)) {
    // Compare only against pre-existing lines: scraped companion lines of the
    // dual-line source format (browsed href + canonical) refer to the same post
    // and must not collapse each other when merging into an absent source.
    if (!existingLines.some((existing) => urlsReferToSamePost(existing, line))) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}
