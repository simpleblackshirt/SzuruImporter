<script setup lang="ts">
import { PropType } from "vue";
import axios, { CancelToken } from "axios";
import { TagDetails } from "~/models";
import { buildNamePattern, deprioritizeTags, encodeTagName, getTagClasses, normalizeName } from "~/utils";
import { stagedSuggestions, type StagedTagInfo } from "~/utils/staged-tags";
import SzurubooruApi from "~/api";
import { cfg } from "~/stores";

const autocompleteItems = ref<TagDetails[]>([]);

const props = defineProps({
  szuru: Object as PropType<SzurubooruApi>,
  /** Staged (creation-card) entries merged ahead of the server results. */
  stagedTags: { type: Array as PropType<StagedTagInfo[]>, default: () => [] },
});
const emit = defineEmits(["addTag", "backspaceOnEmpty", "escapeIdle"]);

// Forwarded focus: PopupMain drops the caret into the tag field on popup open.
const autocompleteRef = ref<{ focus: () => void } | null>(null);

defineExpose({
  focus: () => autocompleteRef.value?.focus(),
});

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
      const serverTags = res.results.map((x) => TagDetails.fromTag(x));
      const serverNames = new Set(serverTags.map((x) => x.name));
      // TODO: Maybe search on hamming distance or something?
      // The server's suggestion endpoint cannot know staged tags - merge
      // them in ahead of the server results, minus names the server just
      // returned (the tag may have been created meanwhile).
      const local = stagedSuggestions(props.stagedTags, input).filter((x) => !serverNames.has(x.name));
      autocompleteItems.value = [...local, ...deprioritizeTags(serverTags, cfg.value.deprioritizedTagCategories)];
    } else {
      autocompleteItems.value = stagedSuggestions(props.stagedTags, input);
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
    ref="autocompleteRef"
    :autocomplete-items="autocompleteItems"
    @add-item="addTag"
    @add-from-current-input="addTagFromCurrentInput"
    @autocomplete-populator="autocompletePopulator"
    @backspace-on-empty="emit('backspaceOnEmpty')"
    @escape-idle="emit('escapeIdle', $event)"
    v-slot="slotProps"
  >
    <span :class="getTagClasses(slotProps.item)">
      {{ slotProps.item.name }}
      <span v-if="slotProps.item.staged" class="new-badge">new</span>
    </span>
    <span class="tag-usages">{{ slotProps.item.usages ? slotProps.item.usages : "" }}</span>
  </AutocompleteInput>
</template>

<style scoped lang="scss">
.new-badge {
  font-size: 0.75em;
  border: 1px solid currentcolor;
  border-radius: 3px;
  padding: 0 0.3em;
  margin-left: 0.3em;
}
</style>
