import type { MicroTag, Tag, TagCategory } from "~/api/models";

/**
 * A tag update for the szurubooru API (see UpdateTagRequest). An update is
 * only emitted when something actually changes, so untouched tags are never
 * PUT (and never get a version bump / edit entry).
 */
export interface TagUpdate {
  /** Primary name of the tag to update. */
  name: string;
  version: number;
  category?: string;
  description?: string;
}

/**
 * The scraped tag data the fixup needs (TagDetails satisfies this structurally;
 * the narrow type keeps the pure helpers decoupled from the view model).
 * `names` is the array field, NOT the `name` getter: these tags arrive in the
 * background via runtime messaging, which strips prototype members - `name`
 * would be undefined here (see the "no getters after deserializing" notes
 * elsewhere in the codebase).
 */
export interface ScrapedTagInfo {
  names: string[];
  category?: string;
  profileUrl?: string;
}

/**
 * The szuru tags of an uploaded post that may need a fixup: those matching a
 * scraped tag that carries a category or a profile url. Returns their primary
 * names for the batched getTags lookup.
 */
export function candidateTagNames(scrapedTags: ScrapedTagInfo[], postTags: MicroTag[]): string[] {
  const relevant = scrapedTags.filter((x) => x.category || x.profileUrl);
  const names: string[] = [];
  for (const postTag of postTags) {
    if (relevant.some((scraped) => postTag.names.includes(scraped.names[0]))) {
      names.push(postTag.names[0]);
    }
  }
  return names;
}

/**
 * Returns the description with the profile url appended on its own line, or
 * undefined when no change is needed: a description that already has the url
 * on any (trimmed) line is left alone.
 */
export function withProfileUrl(description: string | undefined, profileUrl: string): string | undefined {
  const existing = description ?? "";
  if (existing.split(/\r?\n/).some((line) => line.trim() == profileUrl)) {
    return undefined;
  }
  const base = existing.trim();
  return base.length > 0 ? base + "\n" + profileUrl : profileUrl;
}

/**
 * Computes the category/description updates syncing szuru tags to the scraped
 * data, for the post's tags as given by the getTags results.
 *
 * Categories are only applied while the szuru tag still sits in the
 * instance's DEFAULT category (looked up via `TagCategory.default`, never
 * assumed to be named "default" - instances rename it, e.g. to "general"), so
 * deliberately curated categories are never overwritten, and only when the
 * instance actually has the scraped category. Profile urls are merged into
 * the description regardless of the tag's category.
 */
export function computeTagUpdates(
  instanceTags: Tag[],
  scrapedTags: ScrapedTagInfo[],
  categories: TagCategory[],
): TagUpdate[] {
  const defaultCategoryName = categories.find((x) => x.default)?.name;
  const knownCategories = new Set(categories.map((x) => x.name));

  const updates: TagUpdate[] = [];
  for (const instanceTag of instanceTags) {
    const scraped = scrapedTags.find((x) => instanceTag.names.includes(x.names[0]));
    if (!scraped) {
      continue;
    }

    const wantedCategory =
      scraped.category &&
      defaultCategoryName != undefined &&
      instanceTag.category == defaultCategoryName &&
      knownCategories.has(scraped.category) &&
      scraped.category != instanceTag.category
        ? scraped.category
        : undefined;
    const wantedDescription = scraped.profileUrl
      ? withProfileUrl(instanceTag.description, scraped.profileUrl)
      : undefined;

    if (wantedCategory || wantedDescription) {
      updates.push({
        name: instanceTag.names[0],
        version: instanceTag.version,
        category: wantedCategory,
        description: wantedDescription,
      });
    }
  }
  return updates;
}
