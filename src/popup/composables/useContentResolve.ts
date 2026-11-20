import type { ScrapedPostDetails } from "~/models";
import { resolveContentForPosts } from "~/sites";

/**
 * Runs the site adapters' content resolvers over freshly materialized posts
 * and applies the results: video placeholders (twitter blob: stream pointers,
 * bluesky poster candidates) swap in their real content before the review UI
 * probes or renders them. Resolution failures keep the posts in their
 * scraped state and are surfaced on every instance's error banner (the
 * placeholders cannot be uploaded, so failing silently would only move the
 * confusion to upload time).
 */
export async function resolvePostsContent(posts: ScrapedPostDetails[]) {
  if (posts.length == 0) {
    return;
  }

  const resolved = await resolveContentForPosts(posts);
  for (const post of posts) {
    const result = resolved.get(post.id);
    if (!result) {
      continue;
    }
    if (result.error) {
      for (const data of Object.values(post.instanceSpecificData)) {
        data.genericError = result.error;
      }
      continue;
    }
    if (result.contentUrl) post.contentUrl = result.contentUrl;
    if (result.contentType) post.contentType = result.contentType;
    if (result.uploadMode) post.uploadMode = result.uploadMode;
    if (result.resolution) post.resolution = result.resolution;
    if (result.rating) post.rating = result.rating;
    if (result.previewUrl) post.previewUrl = result.previewUrl;
    if (result.plan) post.resolvedContent = result.plan;
  }
}
