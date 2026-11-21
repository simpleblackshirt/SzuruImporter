import mux from "mux.js";

export interface VariantPlaylist {
  url: string;
  bandwidth: number;
}

/**
 * Variant entries of an HLS master playlist (URI + BANDWIDTH), best first.
 * A playlist without #EXT-X-STREAM-INF entries is a media playlist itself -
 * callers fall back to it unchanged.
 */
export function variantPlaylistsFromMaster(master: string, baseUrl: string): VariantPlaylist[] {
  const lines = master.split("\n").map((line) => line.trim());
  const variants: VariantPlaylist[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) {
      continue;
    }
    const uri = lines[i + 1];
    if (!uri || uri.startsWith("#")) {
      continue;
    }
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    variants.push({ url: new URL(uri, baseUrl).href, bandwidth });
  }
  return variants.sort((a, b) => b.bandwidth - a.bandwidth);
}

/** Segment uris of a VOD media playlist, in playback order. */
export function segmentUrlsFromPlaylist(playlist: string, baseUrl: string): string[] {
  return playlist
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((uri) => new URL(uri, baseUrl).href);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetching '${url}' failed with status ${response.status}.`);
  }
  return response.text();
}

/**
 * Downloads the best variant of an HLS playlist and transmuxes its MPEG-TS
 * segments into a single playable mp4 (fragmented, via mux.js). Bluesky
 * serves video exclusively this way: neither the playlist nor a raw segment
 * concat is playable by browsers or uploadable to szurubooru.
 */
export async function transmuxHlsToMp4Blob(playlistUrl: string): Promise<Blob> {
  const playlist = await fetchText(playlistUrl);
  const variants = variantPlaylistsFromMaster(playlist, playlistUrl);
  // A bare media playlist is its own best variant - no second fetch needed.
  const mediaUrl = variants[0]?.url ?? playlistUrl;
  const media = variants.length > 0 ? await fetchText(mediaUrl) : playlist;
  const segments = segmentUrlsFromPlaylist(media, mediaUrl);
  if (segments.length == 0) {
    throw new Error(`HLS media playlist '${mediaUrl}' contains no segments.`);
  }

  const transmuxer = new mux.mp4.Transmuxer();
  const chunks: Uint8Array[] = [];
  let initSegment: Uint8Array | undefined;
  transmuxer.on("data", (segment: { data: Uint8Array; initSegment: Uint8Array }) => {
    initSegment ??= segment.initSegment;
    chunks.push(segment.data);
  });

  for (const segmentUrl of segments) {
    const response = await fetch(segmentUrl);
    if (!response.ok) {
      throw new Error(`Fetching HLS segment '${segmentUrl}' failed with status ${response.status}.`);
    }
    transmuxer.push(new Uint8Array(await response.arrayBuffer()));
  }
  transmuxer.flush();

  if (chunks.length == 0) {
    throw new Error("HLS transmuxing produced no data.");
  }

  const parts: BlobPart[] = initSegment ? [initSegment, ...chunks] : chunks;
  return new Blob(parts, { type: "video/mp4" });
}
