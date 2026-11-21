import type SzurubooruApi from "~/api";
import type { ScrapedPostDetails } from "~/models";
import { transmuxHlsToMp4Blob } from "~/utils/hls";

/**
 * Materializes a resolved-content post into a szurubooru content token:
 * the real bytes are assembled here (background) instead of the popup, so
 * the download + transmux survives a closed popup, and the blob - which
 * cannot cross the JSON message boundary - never needs to. Only reached for
 * posts whose preview was never loaded (previewed posts already have a
 * cached blob the popup uploads itself).
 */
export async function materializeResolvedContent(szuru: SzurubooruApi, post: ScrapedPostDetails): Promise<string> {
  const plan = post.resolvedContent;
  if (!plan) {
    throw new Error("Post has no content resolution plan.");
  }
  switch (plan.kind) {
    case "hls-mp4":
      return (await szuru.uploadTempFileFromBlob(await transmuxHlsToMp4Blob(plan.playlistUrl))).token;
  }
}
