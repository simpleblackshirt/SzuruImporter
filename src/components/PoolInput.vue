<script setup lang="ts">
import { PropType } from "vue";
import axios, { CancelToken } from "axios";
import { PoolDetails } from "~/models";
import { buildNamePattern, encodeTagName, getTagClasses, normalizeName } from "~/utils";
import SzurubooruApi from "~/api";

const autocompleteItems = ref<PoolDetails[]>([]);

const props = defineProps({
  szuru: Object as PropType<SzurubooruApi>,
});
const emit = defineEmits(["addPool"]);

function addPool(tag: PoolDetails) {
  emit("addPool", tag);
}

function addPoolFromCurrentInput(input: string) {
  addPool(new PoolDetails([normalizeName(input)]));
}

async function autocompletePopulator(input: string, ct: CancelToken) {
  const pattern = buildNamePattern(input);
  if (pattern === null) {
    autocompleteItems.value = [];
    return;
  }

  const query = encodeTagName(pattern);

  try {
    const res = await props.szuru?.getPools(query, 0, 100, ["id", "names", "category", "description", "postCount"], ct);
    if (res) {
      // TODO: Maybe search on hamming distance or something?
      autocompleteItems.value = res.results.map((x) => PoolDetails.fromPool(x));
    } else {
      autocompleteItems.value = [];
    }
  } catch (ex) {
    // Swallow cancelled requests; on real errors keep whatever is currently
    // displayed so a single failed query doesn't wipe the dropdown.
    if (axios.isCancel(ex)) return;
    console.warn("Pool autocomplete failed:", ex);
  }
}
</script>

<template>
  <AutocompleteInput
    :autocomplete-items="autocompleteItems"
    @add-item="addPool"
    @add-from-current-input="addPoolFromCurrentInput"
    @autocomplete-populator="autocompletePopulator"
    v-slot="slotProps"
  >
    <span :class="getTagClasses(slotProps.item)">{{ slotProps.item.name }}</span>
    <span class="tag-usages">{{ slotProps.item.usages ? slotProps.item.usages : "" }}</span>
  </AutocompleteInput>
</template>
