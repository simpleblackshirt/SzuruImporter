import { isEqual } from "lodash";
import type { MicroTag, Post, Safety, UpdatePostRequest } from "~/api/models";
import type { ScrapedPostDetails, TagDetails } from "~/models";
import { mergeSources } from "~/utils";

/** Editable post state the merge UI lets the user change before merging. */
export interface MergeEdits {
  source: string | null;
  safety: Safety;
  tags: MicroTag[];
  tagsToAdd: TagDetails[];
}

export type ImageToKeep = "current" | "new";

export interface MergeChangesetOptions {
  /** Editable state to diff against the server post. */
  edited: MergeEdits;
  /** "new" uploads the scraped content and adds its token to the request. */
  imageToKeep: ImageToKeep;
  /** Key into scraped.instanceSpecificData holding the content token. */
  selectedSiteId: string;
  /**
   * Injected side effect (ensurePostHasContentToken): uploads the scraped
   * content when needed and stores the token on scraped.instanceSpecificData.
   */
  ensureContentToken: () => Promise<void>;
}

export interface MergeChangeset {
  request: UpdatePostRequest;
  hasChanges: boolean;
}

/**
 * Appends the scraped source lines to the current source. mergeSources dedups
 * via urlsReferToSamePost, so form variants of an existing source (other
 * locale/host/query) are not appended again.
 * `?? undefined` because Post.source is nullable while mergeSources expects undefined.
 */
export function appendScrapedSource(source: string | null, scrapedSource: string): string {
  return mergeSources(source ?? undefined, scrapedSource);
}

/**
 * Scraped tags missing from the post: a tag counts as present when any of an
 * existing tag's names contains the scraped tag's name (not just names[0]).
 */
export function scrapedMissingTags(postTags: MicroTag[], scrapedTags: TagDetails[]): TagDetails[] {
  return scrapedTags.filter((tag) => postTags.find((x) => x.names.indexOf(tag.name) != -1) == undefined);
}

/**
 * Computes the merge changeset: diffs the editable state against the server
 * post and builds the UpdatePostRequest. Pure aside from the injected
 * ensureContentToken side effect, which is awaited before the token is read.
 */
export async function mergeChangeset(
  existing: Post,
  scraped: ScrapedPostDetails,
  options: MergeChangesetOptions,
): Promise<MergeChangeset> {
  const { edited, imageToKeep, selectedSiteId, ensureContentToken } = options;

  const request: UpdatePostRequest = {
    version: existing.version,
  };

  if (edited.source != existing.source) {
    request.source = edited.source;
  }

  const newTags = edited.tags.map((x) => x.names[0]).concat(edited.tagsToAdd.map((x) => x.name));

  if (
    !isEqual(
      newTags,
      existing.tags.map((x) => x.names[0]),
    )
  ) {
    request.tags = newTags;
  }

  if (edited.safety != existing.safety) {
    request.safety = edited.safety;
  }

  if (imageToKeep == "new") {
    // In practice this should not be needed, because finding similar posts requires the use of content tokens.
    // So if a similar post is found, it means that a contentToken has already been set.
    await ensureContentToken();
    request.contentToken = scraped.instanceSpecificData[selectedSiteId].contentToken!;
  }

  // Empty-string or null source/safety count as "no change" (truthiness-checked).
  const hasChanges =
    !!request.safety ||
    !!request.source ||
    !!(request.contentUrl || request.contentToken) ||
    request.tags !== undefined;

  return { request, hasChanges };
}
