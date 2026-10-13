/**
 * Source-url identity primitives shared by the site adapters: the locale path
 * segments some sites place after the host, the family shape for posts served
 * across several hosts with different path layouts, and the matchers derived
 * from adapter host lists.
 */

// Locale path segments that some sites (e.g. pixiv) place directly after the host.
export const LOCALE_PATH_SEGMENTS = new Set([
  "ar",
  "de",
  "en",
  "en-gb",
  "en-us",
  "es",
  "es-es",
  "es-la",
  "fr",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "pt-br",
  "ru",
  "sv",
  "th",
  "tr",
  "vi",
  "zh",
  "zh-cn",
  "zh-hk",
  "zh-tw",
]);

/**
 * A source-url family: the same post served on several hosts with different
 * path layouts. The idPath pattern anchors the post id as the last path
 * segment, so unrelated urls (e.g. a bare user profile page) with a
 * coincidentally equal last segment stay distinct.
 */
export interface SourceUrlFamily {
  hosts: string[];
  idPath: RegExp;
}

/**
 * Generic family matcher: true when both hosts belong to the family, both
 * paths anchor the post id as their last path segment and those ids match.
 */
export function samePostInFamily(
  family: SourceUrlFamily,
  hostA: string,
  pathA: string,
  hostB: string,
  pathB: string,
): boolean {
  return (
    family.hosts.includes(hostA) &&
    family.hosts.includes(hostB) &&
    family.idPath.test(pathA) &&
    family.idPath.test(pathB) &&
    pathA.slice(pathA.lastIndexOf("/") + 1) == pathB.slice(pathB.lastIndexOf("/") + 1)
  );
}

/** Builds a page-url matcher accepting the given hosts and any subdomain of them. */
export function hostsToMatchUrl(hosts: string[]): RegExp {
  return new RegExp(`^https?:\\/\\/([^/]+\\.)?(${hosts.map((host) => host.replace(/\./g, "\\.")).join("|")})\\/`);
}
