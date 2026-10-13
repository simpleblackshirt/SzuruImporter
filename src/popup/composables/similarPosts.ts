import type { DeepReadonly } from "vue";
import { SimilarPostInfo } from "~/models";
import type { SimpleImageSearchResult } from "~/models";

export function getSimilarPosts(data?: DeepReadonly<SimpleImageSearchResult>): SimilarPostInfo[] {
  if (!data) return [];

  const lst: SimilarPostInfo[] = [];

  for (const similarPost of data.similarPosts) {
    if (data.exactPostId == similarPost.postId) {
      continue;
    }

    lst.push(new SimilarPostInfo(similarPost.postId, Math.round(100 - similarPost.distance * 100)));
  }

  return lst;
}
