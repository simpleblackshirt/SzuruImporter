<script setup lang="ts">
import axios, { CancelTokenSource } from "axios";
import { nextAutocompleteIndex } from "~/utils/keyboard";

// Query once per typing pause instead of once per keystroke. The backend
// queries are expensive enough that stacked requests slow each other down.
const DEBOUNCE_MS = 250;

const inputText = ref("");
const autocompleteShown = ref(false);
const cancelSource = ref<CancelTokenSource | undefined>(undefined);
const autocompleteIndex = ref(-1);
const inputEl = ref<HTMLInputElement | null>(null);
let debounceTimer: number | undefined;

const props = defineProps({
  autocompleteItems: {
    type: Array<any>,
    required: true,
  },
});
const emit = defineEmits(["addItem", "addFromCurrentInput", "autocompletePopulator", "backspaceOnEmpty"]);

// ARIA combobox wiring: unique ids linking the input to its listbox options.
const acId = useId();
const listboxId = `${acId}-listbox`;
const optionId = (idx: number) => `${acId}-option-${idx}`;

function addItem(item: any) {
  emit("addItem", item);
}

function addItemFromCurrentInput() {
  emit("addFromCurrentInput", inputText.value);
  inputText.value = ""; // Reset input

  // Only needed when the button is clicked
  // When this is triggered by the enter key the keydown handler will internally also hide the autocomplete.
  // Though hiding it twice doesn't hurt so we don't care.
  hideAutocomplete();
}

function onAddItemKeyDown(e: KeyboardEvent) {
  // Navigation: arrows step, PageUp/PageDown jump 5 rows, Home/End go to the
  // ends (the dropdown can hold 100 server results). Clamped, with -1 as the
  // "nothing highlighted" slot, matching the pre-existing arrow behavior.
  const nextIndex = nextAutocompleteIndex(e.code, autocompleteIndex.value, props.autocompleteItems.length);
  if (nextIndex !== undefined) {
    e.preventDefault();
    autocompleteIndex.value = nextIndex;
    return;
  }

  if (e.code == "Enter") {
    if (autocompleteIndex.value == -1) {
      addItemFromCurrentInput();
    } else {
      // Add auto completed item
      const itemToAdd = props.autocompleteItems[autocompleteIndex.value];
      addItem(itemToAdd);
      inputText.value = ""; // Reset input
    }
    return;
  }

  // Tab accepts the highlighted suggestion while keeping the caret in the
  // field: rapid multi-tag entry without leaving the input. With nothing
  // highlighted (or no dropdown) Tab moves focus as usual.
  if (e.code == "Tab" && autocompleteShown.value && autocompleteIndex.value >= 0) {
    e.preventDefault();
    addItem(props.autocompleteItems[autocompleteIndex.value]);
    inputText.value = ""; // Reset input - clearing also hides the dropdown
    return;
  }

  // Chip-input convention: Backspace on an empty field removes the last item
  // (parents wire this to tag/pool/implication removal - or to cancelling a
  // pending creation card). Auto-repeats from a held key are ignored: the
  // common "hold Backspace to erase typed text" flow must never cascade into
  // stripping tags once the input empties - every event arriving after the
  // last character is a repeat, and a fresh press always has repeat=false.
  if (e.code == "Backspace" && inputText.value.length == 0) {
    if (e.repeat) return;
    e.preventDefault();
    emit("backspaceOnEmpty");
  }
}

function onClickAutocompleteItem(item: any) {
  addItem(item);
  inputText.value = ""; // Reset input
  autocompleteShown.value = false; // Hide autocomplete list
}

function hideAutocomplete() {
  autocompleteIndex.value = -1;
  autocompleteShown.value = false;
}

// Watching the input value instead of reacting to keyups means modifier keys,
// arrow-key navigation, pasting, and IME input all behave correctly: anything
// that doesn't change the text doesn't fire a query.
watch(inputText, (value) => {
  window.clearTimeout(debounceTimer);

  // Cancel any in-flight query so stale results can't render. The server may
  // still finish executing it, but the client at least stops waiting on it.
  cancelSource.value?.cancel();

  // Editing the text invalidates the current highlight: the highlighted item
  // matched the previous query, so Enter must fall back to the raw typed
  // text until the user navigates the dropdown again. Without this, arrowing
  // to a suggestion (e.g. a deprioritized artist tag at the end of the list)
  // and then fixing a typo would leave Enter bound to the stale pick.
  autocompleteIndex.value = -1;

  // Hide autocomplete when the input is empty, and don't do anything else.
  if (value.length == 0) {
    hideAutocomplete();
    return;
  }

  debounceTimer = window.setTimeout(() => {
    cancelSource.value = axios.CancelToken.source();
    emit("autocompletePopulator", value, cancelSource.value.token);
  }, DEBOUNCE_MS);
});

watch(props, (newValue) => {
  autocompleteShown.value = newValue.autocompleteItems.length > 0;
});

// Exposed so parents (TagInput -> PopupMain) can drop the caret into the field
// when the popup opens.
function focus() {
  inputEl.value?.focus();
}
defineExpose({ focus });
</script>

<template>
  <div style="display: flex; flex-direction: column">
    <div style="display: flex">
      <input
        ref="inputEl"
        type="text"
        v-model="inputText"
        @keydown="onAddItemKeyDown"
        autocomplete="off"
        role="combobox"
        aria-haspopup="listbox"
        :aria-expanded="autocompleteShown ? 'true' : 'false'"
        :aria-controls="listboxId"
        :aria-activedescendant="autocompleteShown && autocompleteIndex >= 0 ? optionId(autocompleteIndex) : undefined"
      />
      <button class="primary" style="margin-left: 5px" @click="addItemFromCurrentInput">Add</button>
    </div>

    <div :id="listboxId" role="listbox" class="autocomplete-items" v-bind:class="{ show: autocompleteShown }">
      <div
        v-for="(item, idx) in autocompleteItems"
        @click="onClickAutocompleteItem(item)"
        :key="item.name"
        role="option"
        :id="optionId(idx)"
        :aria-selected="idx == autocompleteIndex ? 'true' : 'false'"
        :class="{
          active: idx == autocompleteIndex,
        }"
      >
        <slot :item="item"></slot>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.autocomplete-items {
  position: absolute;
  z-index: 10;
  background-color: var(--bg-main-color);
  border: 2px solid var(--primary-color);
  margin-top: 34px;
  display: none;

  &.show {
    display: block;
  }

  > div {
    cursor: pointer;
    padding: 2px 4px;

    display: flex;
    align-items: center;
    gap: 0.5em;

    &:hover {
      background: var(--primary-color);

      > span {
        color: var(--text-color);
      }
    }
  }

  > div.active {
    background: var(--primary-color);

    > span {
      color: var(--text-color);
    }
  }
}
</style>
