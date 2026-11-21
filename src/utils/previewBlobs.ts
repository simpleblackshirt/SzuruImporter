/**
 * Previews a resolved-content HLS post on demand: the user explicitly opts in
 * by clicking the preview's play overlay, and only then are the playlist's
 * segments downloaded and transmuxed. The resulting blob is cached per
 * playlist url so a previewed-then-uploaded post does not download the video
 * twice (the popup uploads the cached blob itself; the background only
 * materializes posts whose preview was never loaded).
 */
import { transmuxHlsToMp4Blob } from "~/utils/hls";

const previewBlobs = new Map<string, Blob>();

export function getCachedPreviewBlob(playlistUrl: string): Blob | undefined {
  return previewBlobs.get(playlistUrl);
}

export async function loadPreviewBlob(playlistUrl: string): Promise<string> {
  let blob = previewBlobs.get(playlistUrl);
  if (!blob) {
    blob = await transmuxHlsToMp4Blob(playlistUrl);
    previewBlobs.set(playlistUrl, blob);
  }
  return URL.createObjectURL(blob);
}
