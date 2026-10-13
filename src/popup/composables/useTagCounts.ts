import type { ComputedRef } from "vue";
import SzurubooruApi from "~/api";
import { usePopupStore } from "~/stores";
import { encodeTagName } from "~/utils";

/** Loads usage counts for the tags of all grabbed posts, in batches. */
export function useTagCounts(szuru: ComputedRef<SzurubooruApi | undefined>) {
  const pop = usePopupStore();

  async function loadTagCounts() {
    const allTags = pop.posts.flatMap((x) => x.tags);

    for (let i = 0; i < allTags.length; i += 100) {
      const query = allTags
        .slice(i, i + 101)
        .map((x) => encodeTagName(x.name))
        .join();

      const resp = await szuru.value?.getTags(query);

      // Not the best code, but it works I guess?
      if (resp) {
        for (const post of pop.posts)
          for (const tag of resp.results) {
            const postTag = post.tags.find((postTag) => tag.names.includes(postTag.name));
            if (postTag) postTag.usages = tag.usages;
          }
      }
    }
  }

  return { loadTagCounts };
}
