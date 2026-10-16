import type { ComputedRef } from "vue";
import SzurubooruApi from "~/api";
import { cfg, usePopupStore } from "~/stores";
import { encodeTagName } from "~/utils";
import { resolveTagAliases } from "./resolveTagAliases";

/**
 * Loads usage counts for the tags of all grabbed posts, in batches. When
 * `resolveTagAliases` is on, the same batched results also rewrite aliased tag
 * names to the instance's primary names, so tags are only fetched once no
 * matter which of the two options (or both) are enabled.
 */
export function useTagCounts(szuru: ComputedRef<SzurubooruApi | undefined>) {
  const pop = usePopupStore();

  async function loadTagCounts() {
    const allTags = pop.posts.flatMap((x) => x.tags);

    for (let i = 0; i < allTags.length; i += 100) {
      const query = allTags
        .slice(i, i + 101)
        .map((x) => encodeTagName(x.name))
        .join();

      // A failed request must not break the grab: treat the batch as "no
      // results" and leave the tags as-is.
      const resp = await szuru.value?.getTags(query).catch(() => undefined);

      // Not the best code, but it works I guess?
      if (resp) {
        for (const post of pop.posts) {
          if (cfg.value.resolveTagAliases) {
            post.tags = resolveTagAliases(post.tags, resp.results);
          }

          for (const tag of resp.results) {
            const postTag = post.tags.find((postTag) => tag.names.includes(postTag.name));
            if (postTag) postTag.usages = tag.usages;
          }
        }
      }
    }
  }

  return { loadTagCounts };
}
