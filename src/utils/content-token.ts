import SzurubooruApi from "../api";
import { ScrapedPostDetails } from "../models";
import { getErrorMessage } from "./format";

export async function ensurePostHasContentToken(selectedInstance: SzurubooruApi, post: ScrapedPostDetails, cfg: any) {
  if (!selectedInstance || !cfg.value.selectedSiteId) return;

  const instanceSpecificData = post.instanceSpecificData[cfg.value.selectedSiteId];

  if (!instanceSpecificData) {
    console.error("instanceSpecificData is undefined. This should never happen!");
    return;
  }

  if (instanceSpecificData.contentToken) {
    console.log("[ensurePostHasContentToken] contentToken is already set.");
    return;
  }

  try {
    const tmpRes = await selectedInstance.uploadTempFile(post.contentUrl, post.uploadMode);
    // Save contentToken in PostViewModel so that we can reuse it when creating/uploading the post.
    instanceSpecificData.contentToken = tmpRes.token;
  } catch (ex) {
    instanceSpecificData.genericError = "Couldn't upload content. " + getErrorMessage(ex);
    throw ex;
  }
}
