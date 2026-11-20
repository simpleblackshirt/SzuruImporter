<script setup lang="ts">
const props = defineProps({
  contentUrl: String,
  notes: {
    type: Array,
    default: () => [],
  },
  contentType: String,
  /** Poster/preview image for video posts whose src is not renderable yet. */
  previewUrl: String,
});

const emit = defineEmits(["onResolutionLoaded"]);

const imgEl = ref<HTMLImageElement | undefined>(undefined);

// Get image width and height from the <img> element.
// This works because we load the full-resolution image in the <img> element.
// This code might stop showing correct resolutions if/when we implement a progressive image loading.
function onloadImage() {
  // A preview image (video post poster) must not overwrite the resolution
  // the content resolver already derived from the actual video.
  if (imgEl.value && !props.previewUrl) {
    emit("onResolutionLoaded", [imgEl.value.naturalWidth, imgEl.value.naturalHeight]);
  }
}
</script>

<template>
  <div class="post-container">
    <!-- Video posts with a preview url (bluesky placeholders) render the
         poster as an image: their contentUrl is a poster still, which a
         <video> element cannot play. -->
    <img
      v-if="contentType != 'video' || previewUrl"
      ref="imgEl"
      :src="previewUrl ?? contentUrl"
      @load="onloadImage"
    />
    <!-- :key re-creates the element when the content resolver swaps the source
         after mount: changing a <source>'s src alone never re-runs the video's
         resource selection, so the old (failed) state would stick. -->
    <video v-else :key="contentUrl" controls :poster="previewUrl">
      <source :src="contentUrl" />
    </video>
    <div class="post-overlay">
      <PostNotes :notes="notes" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.post-overlay {
  position: absolute;
  width: 100%;
  height: 100%;
}

.post-container {
  position: relative;
  display: flex;
}
</style>
