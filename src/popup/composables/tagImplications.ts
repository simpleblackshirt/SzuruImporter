import type { TagDetails } from "~/models";

/**
 * Appends a tag to the target list, followed by its implications when
 * implication expansion is enabled. The `exists` predicate gates BOTH the tag
 * itself and each implication: something already reported as present is never
 * pushed again (previously implications were pushed unconditionally, showing
 * already-present implied tags as duplicates in the UI).
 *
 * The predicate defaults to checking the target list by name, which is what
 * PopupMain needs; MergePost passes one that also consults the existing post
 * tags so implied tags already on the post are not queued for adding.
 */
export function pushTagWithImplications(
  target: TagDetails[],
  tag: TagDetails,
  addImplications: boolean,
  exists: (candidate: TagDetails) => boolean = (candidate) => target.some((x) => x.name == candidate.name),
): void {
  if (!exists(tag)) {
    target.push(tag);
  }

  // Add implications for the tag
  if (addImplications) {
    for (const implication of tag.implications) {
      if (!exists(implication)) {
        target.push(implication);
      }
    }
  }
}
