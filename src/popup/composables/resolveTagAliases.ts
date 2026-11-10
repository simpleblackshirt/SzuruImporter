import type { Tag } from "~/api/models";
import { TagDetails } from "~/models";

/**
 * Rewrites scraped tags that the connected szurubooru instance knows under a
 * different name to the instance's primary name (names[0]), then collapses
 * duplicates the alias-to-primary mapping creates. Tags the instance does not
 * know are returned unchanged.
 *
 * Pure: returns a new array; rewritten tags are fresh TagDetails instances
 * (input tags are never mutated), unchanged tags keep their identity. The
 * caller assigns the result back to post.tags so display and upload payloads
 * pick up the resolved names.
 */
export function resolveTagAliases(tags: TagDetails[], instanceTags: Tag[]): TagDetails[] {
  // Every name of an instance tag (primary or alias) maps to the primary name.
  const primaryByName = new Map<string, string>();
  for (const tag of instanceTags) {
    for (const name of tag.names) {
      primaryByName.set(name, tag.names[0]);
    }
  }

  const resolved: TagDetails[] = [];
  // Resolved name -> index in `resolved` of the representative kept for it.
  const keptAt = new Map<string, number>();

  for (const tag of tags) {
    const primary = primaryByName.get(tag.name);
    let next = tag;
    if (primary !== undefined && primary !== tag.name) {
      // Rewritten tags are fresh instances so the input stays untouched.
      next = new TagDetails([primary], tag.category, tag.usages, tag.profileUrl);
      next.implications = tag.implications;
      // Staged state survives the rewrite: the entry was staged under the
      // alias name, and the save-time race check resolves its fate.
      if (tag.staged) next.staged = tag.staged;
    }

    const existingIndex = keptAt.get(next.name);
    if (existingIndex === undefined) {
      keptAt.set(next.name, resolved.length);
      resolved.push(next);
    } else if (!resolved[existingIndex].category && next.category) {
      // First occurrence wins, unless it lacks a category and this one has one.
      resolved[existingIndex] = next;
    }
  }

  return resolved;
}
