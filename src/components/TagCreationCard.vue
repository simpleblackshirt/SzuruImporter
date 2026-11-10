<script setup lang="ts">
import type { PropType } from "vue";
import axios, { CancelToken } from "axios";
import SzurubooruApi from "~/api";
import { TagDetails } from "~/models";
import type { TagCategory } from "~/api/models";
import { cfg } from "~/stores";
import { buildNamePattern, encodeTagName, getTagClasses, normalizeName } from "~/utils";
import { stagedSuggestions, validateStaging, type StagedTagInfo } from "~/utils/staged-tags";

/**
 * Creation card for a tag that does not exist on the instance yet. Confirming
 * only STAGES the choice (name -> intended category + implications) - zero
 * server writes; the tag is created through the API when the post is saved.
 * An untouched card (preselected category, no implications) is equivalent to
 * the stock add, so confirming degrades to it: the plain name rides the post
 * payload and the backend puts it into the default category - atomic with the
 * save (no orphan risk) and without any tag API calls.
 */
const props = defineProps({
  szuru: Object as PropType<SzurubooruApi>,
  tagName: { type: String, required: true },
  /**
   * Already-staged entries whose save will create them - the selected post's
   * staged set. Implication targets may only reference these (or known tags),
   * so a one-shot save can actually materialize every edge.
   */
  stagedTags: { type: Array as PropType<StagedTagInfo[]>, default: () => [] },
});
const emit = defineEmits(["confirm", "skip"]);

// Instance categories with the true default category name (instances can
// rename it), falling back to the user-curated list.
const categories = ref<TagCategory[]>([]);
const selectedCategory = ref("");
// The category reset() preselected. "Untouched" means this is still selected.
const initialCategory = ref("");
const implications = ref<TagDetails[]>([]);
const implicationItems = ref<TagDetails[]>([]);
const validationError = ref("");
// Names known to exist on the instance, resolved at confirm time.
const knownNames = ref<Set<string>>(new Set());

const defaultCategoryName = computed(() => categories.value.find((x) => x.default)?.name ?? "default");

const categoryOptions = computed(() => {
  if (categories.value.length > 0) {
    return categories.value.map((x) => ({ name: x.name, color: x.color }));
  }
  return cfg.value.tagCategories.map((x) => ({ name: x.name, color: x.color }));
});

const isUntouched = computed(
  () => implications.value.length == 0 && selectedCategory.value == initialCategory.value,
);

function reset() {
  implications.value = [];
  implicationItems.value = [];
  validationError.value = "";
  knownNames.value = new Set();
  selectedCategory.value =
    categoryOptions.value.find((x) => x.name == defaultCategoryName.value)?.name ??
    categoryOptions.value[0]?.name ??
    "default";
  initialCategory.value = selectedCategory.value;
}

watch(
  () => props.tagName,
  async (name) => {
    reset();

    // The tag may exist on the instance without us knowing (stale autocomplete
    // data), and confirming needs to resolve implication targets against the
    // instance. Failures leave the checks empty - validation then only
    // accepts staged targets, and the user can retry.
    try {
      const [tagsRes, categoriesRes] = await Promise.all([
        props.szuru?.getTags(encodeTagName(name), 0, 1, ["names"]),
        props.szuru?.getTagCategories().catch(() => undefined),
      ]);
      knownNames.value = new Set(tagsRes?.results.flatMap((x) => x.names) ?? []);
      if (categoriesRes?.results.length) {
        categories.value = categoriesRes.results;
      }
      reset();
    } catch (ex) {
      console.warn("Tag creation card lookup failed:", ex);
    }
  },
  { immediate: true },
);

async function autocompleteImplications(input: string, ct: CancelToken) {
  const pattern = buildNamePattern(input);
  if (pattern === null) {
    implicationItems.value = [];
    return;
  }

  const local = stagedSuggestions(props.stagedTags, input).filter(
    (x) => x.name != props.tagName && !implications.value.some((y) => y.name == x.name),
  );

  try {
    const query = `${encodeTagName(pattern)} sort:usages`;
    const res = await props.szuru?.getTags(query, 0, 100, ["names", "category", "usages", "implications"], ct);
    const server = (res?.results ?? [])
      .filter((x) => x.names[0] != props.tagName && !implications.value.some((y) => y.name == x.name))
      .map((x) => TagDetails.fromTag(x));
    implicationItems.value = [...local, ...server];
  } catch (ex) {
    if (axios.isCancel(ex)) return;
    console.warn("Implication autocomplete failed:", ex);
    implicationItems.value = local;
  }
}

function addImplication(item: TagDetails) {
  if (implications.value.some((x) => x.name == item.name) || item.name == props.tagName) {
    return;
  }
  implications.value.push(item);
}

function addImplicationFromInput(input: string) {
  const name = normalizeName(input);
  if (name.length > 0) {
    addImplication(new TagDetails([name]));
  }
}

function removeImplication(tag: TagDetails) {
  implications.value = implications.value.filter((x) => x.name != tag.name);
}

async function confirm() {
  // An untouched card is equivalent to the stock add, but the stock path is
  // atomic with the post save while staging is not (a failed save after
  // successful creation leaves an orphan). Degrade to the stock add - zero
  // API calls, including the implication existence check below.
  if (isUntouched.value) {
    skip();
    return;
  }

  // Validation happens at staging, against a relaxed notion of "exists":
  // targets must exist on the instance or be staged. The typed implication
  // names are resolved against the instance here - the definitive check,
  // because the backend silently drops unknown implication names.
  const names = [...new Set(implications.value.map((x) => x.name))];
  if (names.length > 0) {
    try {
      const res = await props.szuru?.getTags(names.map(encodeTagName).join(","), 0, 100, ["names"]);
      const confirmed = new Set(res?.results.flatMap((x) => x.names) ?? []);
      knownNames.value = new Set([...knownNames.value, ...confirmed]);
    } catch (ex) {
      console.warn("Implication existence check failed:", ex);
    }
  }

  validationError.value = validateStaging(props.tagName, names, props.stagedTags, knownNames.value);
  if (validationError.value) return;

  emit("confirm", {
    category: selectedCategory.value,
    implications: names,
  });
}

function skip() {
  emit("skip");
}
</script>

<template>
  <div class="tag-creation-card">
    <div class="card-title">
      <span>New tag: <strong v-html="tagName"></strong></span>
    </div>

    <span class="card-label">Category</span>
    <select v-model="selectedCategory">
      <option v-for="cat in categoryOptions" :key="cat.name" :value="cat.name">{{ cat.name }}</option>
    </select>

    <span class="card-label">Implications</span>
    <div class="implications-editor">
      <AutocompleteInput
        :autocomplete-items="implicationItems"
        @add-item="addImplication"
        @add-from-current-input="addImplicationFromInput"
        @autocomplete-populator="autocompleteImplications"
        v-slot="slotProps"
      >
        <span :class="getTagClasses(slotProps.item)">
          {{ slotProps.item.name }}
          <span v-if="slotProps.item.staged" class="new-badge">new</span>
        </span>
        <span class="tag-usages">{{ slotProps.item.usages ? slotProps.item.usages : "" }}</span>
      </AutocompleteInput>

      <ul class="implication-chips">
        <li v-for="implication in implications" :key="implication.name">
          <span :class="getTagClasses(implication)">{{ implication.name }}</span>
          <a class="remove-tag" @click="removeImplication(implication)">x</a>
        </li>
      </ul>
    </div>

    <div v-if="validationError" class="card-error">{{ validationError }}</div>

    <div class="card-actions">
      <button class="primary full" @click="confirm">Add tag</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tag-creation-card {
  border: 1px solid var(--primary-color);
  border-radius: 3px;
  padding: 6px;
  /* ONE shared grid for label + control rows: the max-content label column
     sizes once to the widest label ("Implications"), so both inputs start at
     the same x. Per-row grids would size each label column separately and
     never align. */
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 5px;
  align-items: center;
}

.card-title,
.card-error,
.card-actions {
  grid-column: 1 / -1;
}

.card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-label {
  font-size: 0.85em;
}

select {
  width: 100%;
}

.implications-editor {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.implication-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;

  > li {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
}

.card-error {
  color: var(--danger-color);
}

.card-actions {
  display: flex;
  gap: 5px;
}

.new-badge {
  font-size: 0.75em;
  border: 1px solid currentcolor;
  border-radius: 3px;
  padding: 0 0.3em;
  margin-left: 0.3em;
}
</style>
