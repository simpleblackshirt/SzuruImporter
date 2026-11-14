<script setup lang="ts">
import type { PropType } from "vue";

/**
 * Toggleable overlay listing the keyboard shortcuts. The pages own the open
 * state (toggled by "?" via useKeyboardShortcuts; Escape closes it too) and
 * supply their own shortcut rows, so popup and merge can differ.
 */
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  shortcuts: {
    type: Array as PropType<Array<{ keys: string; label: string }>>,
    required: true,
  },
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <div v-if="props.modelValue" class="cheatsheet-backdrop" @click="$emit('update:modelValue', false)">
    <div class="cheatsheet-card" role="dialog" aria-label="Keyboard shortcuts" @click.stop>
      <div class="cheatsheet-header">
        <span>Keyboard shortcuts</span>
        <a class="cheatsheet-close" title="Close" @click="$emit('update:modelValue', false)">x</a>
      </div>

      <table class="cheatsheet-table">
        <tbody>
          <tr v-for="s in props.shortcuts" :key="s.keys + s.label">
            <td class="cheatsheet-keys">
              <kbd>{{ s.keys }}</kbd>
            </td>
            <td>{{ s.label }}</td>
          </tr>
        </tbody>
      </table>

      <div class="cheatsheet-hint">Single-key shortcuts never fire while typing in a text field.</div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.cheatsheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.cheatsheet-card {
  background: var(--bg-main-color);
  color: var(--text-color);
  border: 2px solid var(--primary-color);
  border-radius: 3px;
  padding: 8px 12px;
  max-width: 92vw;
  max-height: 90vh;
  overflow: auto;
  font-size: 90%;
}

.cheatsheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-weight: bold;
  margin-bottom: 6px;
}

.cheatsheet-close {
  cursor: pointer;
  padding: 0 4px;
}

.cheatsheet-table {
  border-collapse: collapse;

  td {
    padding: 2px 8px 2px 0;
    vertical-align: top;
  }
}

.cheatsheet-keys {
  white-space: nowrap;
}

kbd {
  font-family: monospace;
  font-size: 90%;
  border: 1px solid var(--border-color);
  border-bottom-width: 2px;
  border-radius: 3px;
  padding: 0 4px;
  background: var(--bg-secondary-color);
}

.cheatsheet-hint {
  margin-top: 6px;
  font-size: 85%;
  color: var(--secondary-text);
}
</style>
