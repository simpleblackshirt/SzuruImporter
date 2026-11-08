<script setup lang="ts">
import axios, { CancelTokenSource } from "axios";

// Query once per typing pause instead of once per keystroke. The backend
// queries are expensive enough that stacked requests slow each other down.
const DEBOUNCE_MS = 250;

const inputText = ref("");
const autocompleteShown = ref(false);
const cancelSource = ref<CancelTokenSource | undefined>(undefined);
const autocompleteIndex = ref(-1);
let debounceTimer: number | undefined;

const props = defineProps({
  autocompleteItems: {
    type: Array<any>,
    required: true,
  },
});
const emit = defineEmits(["addItem", "addFromCurrentInput", "autocompletePopulator"]);

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
  if (e.code == "ArrowDown") {
    e.preventDefault();
    if (autocompleteIndex.value < props.autocompleteItems.length - 1) {
      autocompleteIndex.value++;
    }
  } else if (e.code == "ArrowUp") {
    e.preventDefault();
    if (autocompleteIndex.value >= 0) {
      autocompleteIndex.value--;
    }
  } else if (e.code == "Enter") {
    if (autocompleteIndex.value == -1) {
      addItemFromCurrentInput();
    } else {
      // Add auto completed item
      const itemToAdd = props.autocompleteItems[autocompleteIndex.value];
      addItem(itemToAdd);
      inputText.value = ""; // Reset input
    }
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
</script>

<template>
  <div style="display: flex; flex-direction: column">
    <div style="display: flex">
      <input type="text" v-model="inputText" @keydown="onAddItemKeyDown" autocomplete="off" />
      <button class="primary" style="margin-left: 5px" @click="addItemFromCurrentInput">Add</button>
    </div>

    <div class="autocomplete-items" v-bind:class="{ show: autocompleteShown }">
      <div
        v-for="(item, idx) in autocompleteItems"
        @click="onClickAutocompleteItem(item)"
        :key="item.name"
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
