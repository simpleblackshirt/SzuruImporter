import type { ComputedRef } from "vue";
import SzurubooruApi from "~/api";
import { cfg, usePopupStore } from "~/stores";
import { encodeTagName } from "~/utils";
import { applyInstanceTagData } from "./applyInstanceTagData";

/**
 * Loads usage counts and categories for the tags of all grabbed posts, in
 * batches (see applyInstanceTagData). When `resolveTagAliases` is on, the
 * same batched results also rewrite aliased tag names to the instance's
 * primary names, so tags are only fetched once no matter which of the two
 * options (or both) are enabled.
 */
export function useTagCounts(szuru: ComputedRef<SzurubooruApi | undefined>) {
  const pop = usePopupStore();

  async function loadTagCounts() {
    const allTags = pop.posts.flatMap((x) => x.tags);

    for (let i = 0; i < allTags.length; i += 100) {
      const query = allTags
        .slice(i, i + 100)
        .map((x) => encodeTagName(x.name))
        .join();

      // A failed request must not break the grab: treat the batch as "no
      // results" and leave the tags as-is.
      const resp = await szuru.value?.getTags(query).catch(() => undefined);

      if (resp) {
        for (const post of pop.posts) {
          post.tags = applyInstanceTagData(post.tags, resp.results, cfg.value.resolveTagAliases);
        }
      }
    }
  }

  return { loadTagCounts };
}
