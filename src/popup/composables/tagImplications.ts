import type { TagDetails } from "~/models";

/**
 * Appends a tag to the target list, followed by its implications when
 * implication expansion is enabled. Shared by PopupMain and MergePost; the
 * duplicate-existence check stays with the caller because it differs per page
 * (selectedPost.tags matched by name vs tagsToAdd plus existing post tags
 * matched by names[]).
 */
export function pushTagWithImplications(target: TagDetails[], tag: TagDetails, addImplications: boolean): void {
  target.push(tag);

  // Add implications for the tag
  if (addImplications) {
    target.push(...tag.implications);
  }
}
