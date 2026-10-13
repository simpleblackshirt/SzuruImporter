import { ref, toRaw } from "vue";
import type { ComputedRef } from "vue";
import SzurubooruApi from "~/api";
import { cfg, usePopupStore } from "~/stores";
import { ensurePostHasContentToken, getErrorMessage } from "~/utils";
import type { ScrapedPostDetails, SimpleSimilarPost } from "~/models";

/** Orchestrates the reverse search ("find similar") for the selected post. */
export function useSimilarSearch(szuru: ComputedRef<SzurubooruApi | undefined>) {
  const pop = usePopupStore();
  const isSearchingForSimilarPosts = ref<number>(0);
  const enableAutoSearch = ref(true);

  async function clickFindSimilar() {
    if (pop.selectedPost) return await findSimilar(pop.selectedPost);
  }

  async function findSimilar(post: ScrapedPostDetails | undefined) {
    if (!post || !szuru.value || !cfg.value.selectedSiteId) return;

    // TODO: This code might not work.
    // Why is toRaw used?
    // I guess it could happen that the selectedInstance changes halfway during this function?
    // And in that case toRaw would ensure we have the original selected instance (as it was at the start of this function).
    // In theory this sounds correct, but idk if it is needed in practice.
    const selectedInstance = toRaw(szuru.value); // Get current object, and not reactive.
    const instanceSpecificData = post.instanceSpecificData[cfg.value.selectedSiteId];

    if (!instanceSpecificData) {
      console.error("instanceSpecificData is undefined. This should never happen!");
      return;
    }

    // Don't load this again if it is already loaded.
    if (instanceSpecificData.reverseSearchResult) return;

    isSearchingForSimilarPosts.value++;

    try {
      await ensurePostHasContentToken(selectedInstance, post, cfg);

      const res = await selectedInstance.reverseSearchToken(instanceSpecificData.contentToken!);

      instanceSpecificData.reverseSearchResult = {
        exactPostId: res.exactPost?.id,
        similarPosts: res.similarPosts.map((x) => <SimpleSimilarPost>{ postId: x.post.id, distance: x.distance }),
      };
    } catch (ex: any) {
      instanceSpecificData.genericError = "Couldn't reverse search. " + getErrorMessage(ex);
    }

    isSearchingForSimilarPosts.value--;
  }

  return { isSearchingForSimilarPosts, enableAutoSearch, findSimilar, clickFindSimilar };
}
