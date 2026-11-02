import type { Tag } from "~/api/models";
import type { TagDetails } from "~/models";
import { resolveTagAliases } from "./resolveTagAliases";

/**
 * Enriches scraped tags with data from the matching instance tags (the
 * batched getTags results): copies the usage count and fills in the
 * instance's category when the scraped tag has none. The filled-in category
 * is what colors backend-known tags in the popup (see getTagClasses and the
 * dynamic `.tag-<category>` rules). A category scraped from the source site
 * wins, mirroring the upload flow which pushes scraped categories onto
 * instance tags still in the instance's default category.
 *
 * When `resolveAliases` is set, tags are renamed to the instance's primary
 * name first (see resolveTagAliases) so enrichment matches on the resolved
 * name too.
 *
 * Mutates matched TagDetails in place and returns the tag array to assign
 * back to post.tags (a new array only when alias resolution rewrote names).
 */
export function applyInstanceTagData(
  tags: TagDetails[],
  instanceTags: Tag[],
  resolveAliases: boolean,
): TagDetails[] {
  const resolved = resolveAliases ? resolveTagAliases(tags, instanceTags) : tags;

  for (const tag of instanceTags) {
    const postTag = resolved.find((postTag) => tag.names.includes(postTag.name));
    if (postTag) {
      postTag.usages = tag.usages;
      if (!postTag.category) {
        postTag.category = tag.category;
      }
    }
  }

  return resolved;
}
