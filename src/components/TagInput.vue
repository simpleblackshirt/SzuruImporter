<script setup lang="ts">
import { PropType } from "vue";
import axios, { CancelToken } from "axios";
import { TagDetails } from "~/models";
import { buildNamePattern, deprioritizeTags, encodeTagName, getTagClasses, normalizeName } from "~/utils";
import SzurubooruApi from "~/api";
import { cfg } from "~/stores";

const autocompleteItems = ref<TagDetails[]>([]);

const props = defineProps({
  szuru: Object as PropType<SzurubooruApi>,
});
const emit = defineEmits(["addTag"]);

function addTag(tag: TagDetails) {
  emit("addTag", tag);
}

function addTagFromCurrentInput(input: string) {
  addTag(new TagDetails([normalizeName(input)]));
}

async function autocompletePopulator(input: string, ct: CancelToken) {
  const pattern = buildNamePattern(input);
  if (pattern === null) {
    autocompleteItems.value = [];
    return;
  }

  const query = `${encodeTagName(pattern)} sort:usages`;

  try {
    const res = await props.szuru?.getTags(query, 0, 100, ["names", "category", "usages", "implications"], ct);
    if (res) {
      // TODO: Maybe search on hamming distance or something?
      autocompleteItems.value = deprioritizeTags(
        res.results.map((x) => TagDetails.fromTag(x)),
        cfg.value.deprioritizedTagCategories,
      );
    } else {
      autocompleteItems.value = [];
    }
  } catch (ex) {
    // Swallow cancelled requests; on real errors keep whatever is currently
    // displayed so a single failed query doesn't wipe the dropdown.
    if (axios.isCancel(ex)) return;
    console.warn("Tag autocomplete failed:", ex);
  }
}
</script>

<template>
  <AutocompleteInput
    :autocomplete-items="autocompleteItems"
    @add-item="addTag"
    @add-from-current-input="addTagFromCurrentInput"
    @autocomplete-populator="autocompletePopulator"
    v-slot="slotProps"
  >
    <span :class="getTagClasses(slotProps.item)">{{ slotProps.item.name }}</span>
    <span class="tag-usages">{{ slotProps.item.usages ? slotProps.item.usages : "" }}</span>
  </AutocompleteInput>
</template>
