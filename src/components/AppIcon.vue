<script setup lang="ts">
import { computed } from "vue";

/**
 * Inline SVGs replacing the four Font Awesome solid icons used in the UI.
 * Dropping @fortawesome/* removed its runtime DOM/CSS injection from the
 * shared chunk (AMO validator innerHTML warnings) and cut bundle size.
 * Path data is Font Awesome Free (CC BY 4.0) - see README for attribution.
 */
const icons = {
  "chevron-up": {
    w: 448,
    h: 512,
    d: "M201.4 105.4c12.5-12.5 32.8-12.5 45.3 0l192 192c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L224 173.3 54.6 342.6c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3l192-192z",
  },
  "chevron-down": {
    w: 448,
    h: 512,
    d: "M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z",
  },
  "chevron-left": {
    w: 320,
    h: 512,
    d: "M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z",
  },
  cog: {
    w: 512,
    h: 512,
    d: "M195.1 9.5C198.1-5.3 211.2-16 226.4-16l59.8 0c15.2 0 28.3 10.7 31.3 25.5L332 79.5c14.1 6 27.3 13.7 39.3 22.8l67.8-22.5c14.4-4.8 30.2 1.2 37.8 14.4l29.9 51.8c7.6 13.2 4.9 29.8-6.5 39.9L447 233.3c.9 7.4 1.3 15 1.3 22.7s-.5 15.3-1.3 22.7l53.4 47.5c11.4 10.1 14 26.8 6.5 39.9l-29.9 51.8c-7.6 13.1-23.4 19.2-37.8 14.4l-67.8-22.5c-12.1 9.1-25.3 16.7-39.3 22.8l-14.4 69.9c-3.1 14.9-16.2 25.5-31.3 25.5l-59.8 0c-15.2 0-28.3-10.7-31.3-25.5l-14.4-69.9c-14.1-6-27.2-13.7-39.3-22.8L73.5 432.3c-14.4 4.8-30.2-1.2-37.8-14.4L5.8 366.1c-7.6-13.2-4.9-29.8 6.5-39.9l53.4-47.5c-.9-7.4-1.3-15-1.3-22.7s.5-15.3 1.3-22.7L12.3 185.8c-11.4-10.1-14-26.8-6.5-39.9L35.7 94.1c7.6-13.2 23.4-19.2 37.8-14.4l67.8 22.5c12.1-9.1 25.3-16.7 39.3-22.8L195.1 9.5zM256.3 336a80 80 0 1 0 -.6-160 80 80 0 1 0 .6 160z",
  },
} as const;

const props = defineProps<{
  name: keyof typeof icons;
}>();

const icon = computed(() => icons[props.name]);
</script>

<template>
  <!-- Same geometry FA used: 1em height, width proportional to the viewBox. -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="app-icon"
    aria-hidden="true"
    fill="currentColor"
    :viewBox="`0 0 ${icon.w} ${icon.h}`"
    :style="{ width: `${icon.w / icon.h}em` }"
  >
    <path :d="icon.d" />
  </svg>
</template>

<style lang="scss" scoped>
/* Matches .svg-inline--fa layout so existing spacing is unchanged. */
.app-icon {
  display: inline-block;
  height: 1em;
  vertical-align: -0.125em;
  overflow: visible;
}
</style>
