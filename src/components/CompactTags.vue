<script setup lang="ts">
import type { PropType } from "vue";
import type { TagDetails } from "~/models";
import { getTagClasses, breakTagName } from "~/utils";

defineProps({
  tags: Array as PropType<TagDetails[]>,
  showUsages: Boolean,
  showRemoveTag: Boolean,
});
defineEmits(["removeTag"]);
</script>

<template>
  <ul class="compact-tags">
    <li v-for="tag in tags" :key="tag.name">
      <a v-if="showRemoveTag" class="remove-tag" @click="$emit('removeTag', tag)">x</a>
      <span
        :class="getTagClasses(tag)"
        :title="tag.staged ? 'New tag - staged for creation' + (tag.staged.implications.length ? ' (implies: ' + tag.staged.implications.join(', ') + ')' : '') : undefined"
        v-html="breakTagName(tag.name)"
      ></span>
      <span v-if="tag.staged" class="new-badge">new</span>
      <span v-if="showUsages" class="tag-usages tag-usages-reserve-space">{{ tag.usages ? tag.usages : "" }}</span>
    </li>
  </ul>
</template>

<style scoped lang="scss">
/* Hacky way to stop the layout from resizing when we lazy load the usage count. */
.tag-usages-reserve-space {
  min-width: 5ch;
  /* 5 character width */
  display: inline-block;
}

.new-badge {
  font-size: 0.75em;
  border: 1px solid currentcolor;
  border-radius: 3px;
  padding: 0 0.3em;
}
</style>
