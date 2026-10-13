import { cloneDeep } from "lodash";
import type { ComputedRef } from "vue";
import SzurubooruApi from "~/api";
import { BrowserCommand, PostUploadCommandData, ScrapedPostDetails, SzuruSiteConfig } from "~/models";
import { cfg, usePopupStore } from "~/stores";
import { ensurePostHasContentToken } from "~/utils";

interface UploadDeps {
  szuru: ComputedRef<SzurubooruApi | undefined>;
  selectedSite: ComputedRef<SzuruSiteConfig | undefined>;
}

/** Sends the selected post to the background script for upload on the selected site. */
export function useUpload(deps: UploadDeps) {
  const pop = usePopupStore();
  const { szuru, selectedSite } = deps;

  async function upload() {
    if (!cfg.value.selectedSiteId) return;
    const instanceSpecificData = pop.selectedPost?.instanceSpecificData[cfg.value.selectedSiteId];

    // Don't try to upload if an exact copy is already on the server.
    if (instanceSpecificData?.reverseSearchResult?.exactPostId) return;

    if (instanceSpecificData) {
      instanceSpecificData.uploadState = { state: "uploading" };
    }

    try {
      const post: ScrapedPostDetails = cloneDeep(pop.selectedPost)!;

      // uploadMode "content" requires a content token to work. So ensure it is set.
      if (post.uploadMode === "content") {
        await ensurePostHasContentToken(szuru.value!, post, cfg);
      }

      const cmdData = new PostUploadCommandData(
        post,
        <SzuruSiteConfig>cloneDeep(selectedSite.value),
        cfg.value.sendUploadNotifications,
      );
      const cmd = new BrowserCommand("upload_post", cmdData);
      await browser.runtime.sendMessage(cmd);
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
