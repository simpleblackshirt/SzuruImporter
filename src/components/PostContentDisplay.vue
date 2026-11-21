<script setup lang="ts">
import { loadPreviewBlob } from "~/utils/previewBlobs";

const props = defineProps({
  contentUrl: String,
  notes: {
    type: Array,
    default: () => [],
  },
  contentType: String,
  /** Poster/preview image for video placeholders (bluesky HLS). */
  previewUrl: String,
  /**
   * HLS playlist of a resolved-content video placeholder: its bytes do not
   * exist until the background assembles them at upload time, so the preview
   * stays a poster until the user explicitly loads it (play overlay).
   */
  playlistUrl: String,
});

const emit = defineEmits(["onResolutionLoaded"]);

const imgEl = ref<HTMLImageElement | undefined>(undefined);
const videoEl = ref<HTMLVideoElement | undefined>(undefined);
const previewBlobUrl = ref<string | undefined>(undefined);
const loadingPreview = ref(false);
const previewFailed = ref(false);

// Get image width and height from the <img> element.
// This works because we load the full-resolution image in the <img> element.
// This code might stop showing correct resolutions if/when we implement a progressive image loading.
function onloadImage() {
  // I guess post/selectedPost could have a race condition here?
  // Seems very unlikely though, as the load event gets cancelled as soon as we change the :src attribute.
  // A race condition might even be impossible then.
  if (imgEl.value) {
    emit("onResolutionLoaded", [imgEl.value.naturalWidth, imgEl.value.naturalHeight]);
  }
}

/**
 * Loads the placeholder's real video on demand (download + transmux - the
 * expensive part must never run for posts the user merely scrolls past),
 * caches the blob for the upload so it is not fetched twice, and starts
 * playback. Play may be rejected when the async work outlives the user
 * gesture - the controls remain usable.
 */
async function loadAndPlayPreview() {
  if (!props.playlistUrl || loadingPreview.value) {
    return;
  }
  loadingPreview.value = true;
  previewFailed.value = false;
  try {
    previewBlobUrl.value = await loadPreviewBlob(props.playlistUrl);
    await nextTick();
    // Inserting the <source> does not re-run the video's resource selection -
    // an explicit load() is required for the fresh source to be picked up.
    videoEl.value?.load();
    videoEl.value?.play()?.catch(() => undefined);
  } catch {
    previewFailed.value = true;
  } finally {
    loadingPreview.value = false;
  }
}

/**
 * The control bar's play button on a still-unloaded placeholder fires the
 * play event with no resource to play - route it into the on-demand load
 * (paused first, so the element does not sit in a fake playing state);
 * playback starts once the transmuxed source is ready.
 */
function onVideoPlay() {
  if (props.playlistUrl && !previewBlobUrl.value && !loadingPreview.value) {
    videoEl.value?.pause();
    void loadAndPlayPreview();
  }
}

onBeforeUnmount(() => {
  if (previewBlobUrl.value) {
    URL.revokeObjectURL(previewBlobUrl.value);
  }
});
</script>

<template>
  <div class="post-container">
    <!-- Video placeholders (bluesky HLS) render WITHOUT a source: their bytes
         only exist after on-demand assembly. The poster plus play overlay
         marks them as videos; loading swaps in the real, playable source. -->
    <video
      v-if="contentType == 'video'"
      ref="videoEl"
      :key="contentUrl"
      controls
      :poster="previewUrl"
      @play="onVideoPlay"
      @loadedmetadata="emit('onResolutionLoaded', [videoEl.videoWidth, videoEl.videoHeight])"
    >
      <source v-if="!playlistUrl" :src="contentUrl" />
      <source v-if="previewBlobUrl" :src="previewBlobUrl" />
    </video>
    <img v-else ref="imgEl" :src="contentUrl" @load="onloadImage" />
    <div v-if="contentType == 'video' && playlistUrl && !previewBlobUrl" class="preview-overlay">
      <button class="play-button" :disabled="loadingPreview" @click="loadAndPlayPreview">
        <AppIcon v-if="!loadingPreview && !previewFailed" name="play" />
        <span v-else-if="loadingPreview">loading…</span>
        <span v-else>preview failed</span>
      </button>
    </div>
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
  // Purely visual (note hover regions): without this the overlay swallows
  // every click on the video's native controls (play/seek/volume).
  pointer-events: none;
}

.preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 0.75rem;

  svg {
    width: 1.75rem;
    height: 1.75rem;
    margin-left: 0.15rem; // optical centering of the triangle
  }

  &:disabled {
    cursor: default;
  }
}

.post-container {
  position: relative;
  display: flex;
}
</style>
