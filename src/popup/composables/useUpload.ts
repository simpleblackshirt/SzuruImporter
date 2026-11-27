import { cloneDeep } from "es-toolkit";
import type { ComputedRef } from "vue";
import SzurubooruApi from "~/api";
import { BrowserCommand, PostUploadCommandData, ScrapedPostDetails, SzuruSiteConfig } from "~/models";
import { cfg, usePopupStore } from "~/stores";
import { getCachedPreviewBlob } from "~/utils/previewBlobs";
import { ensurePostHasContentToken } from "~/utils";

interface UploadDeps {
  szuru: ComputedRef<SzurubooruApi | undefined>;
  selectedSite: ComputedRef<SzuruSiteConfig | undefined>;
}

/**
 * Result of an upload attempt:
 * - "sent": the upload command went to the background
 * - "duplicate": the exact post is already on the server (deliberate no-op)
 * - "busy": no target site selected or an upload is already in flight
 */
export type UploadAttempt = "sent" | "duplicate" | "busy";

/** Sends the selected post to the background script for upload on the selected site. */
export function useUpload(deps: UploadDeps) {
  const pop = usePopupStore();
  const { szuru, selectedSite } = deps;

  async function upload(): Promise<UploadAttempt> {
    if (!cfg.value.selectedSiteId) return "busy";

    // The grab's population pipeline (lofter permalink upgrade, content
    // resolution, info probes) is still changing the content urls - the
    // selected post's rendition is not final yet.
    if (pop.grabPipelineRunning) return "busy";

    const instanceSpecificData = pop.selectedPost?.instanceSpecificData[cfg.value.selectedSiteId];

    // Don't try to upload if an exact copy is already on the server.
    if (instanceSpecificData?.reverseSearchResult?.exactPostId) return "duplicate";

    // Re-entry guard: an upload already in flight (double-click or a second
    // Ctrl+Enter) must not fire another upload command.
    if (instanceSpecificData?.uploadState?.state == "uploading") return "busy";

    if (instanceSpecificData) {
      instanceSpecificData.uploadState = { state: "uploading" };
    }

    try {
      const post: ScrapedPostDetails = cloneDeep(pop.selectedPost)!;

      // uploadMode "content" requires a content token to work. Posts with a
      // resolution plan either have a preview-cached blob (uploaded from this
      // side, so the video is not downloaded twice) or get their content
      // materialized by the background inside the upload command itself.
      if (post.resolvedContent?.kind == "hls-mp4") {
        const cachedBlob = getCachedPreviewBlob(post.resolvedContent.playlistUrl);
        if (cachedBlob) {
          post.instanceSpecificData[cfg.value.selectedSiteId]!.contentToken = (
            await szuru.value!.uploadTempFileFromBlob(cachedBlob)
          ).token;
        }
      } else if (post.uploadMode === "content") {
        await ensurePostHasContentToken(szuru.value!, post, cfg);
      }

      const cmdData = new PostUploadCommandData(
        post,
        <SzuruSiteConfig>cloneDeep(selectedSite.value),
        cfg.value.sendUploadNotifications,
      );
      const cmd = new BrowserCommand("upload_post", cmdData);
      await browser.runtime.sendMessage(cmd);
      return "sent";
    } catch (ex: any) {
      if (instanceSpecificData?.uploadState) {
        instanceSpecificData.uploadState.state = "error";
        instanceSpecificData.uploadState.error = ex.toString();
      }
      throw ex;
    }
  }

  return { upload };
}
