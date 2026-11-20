import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type SzurubooruApi from "~/api";
import type { ScrapedPostDetails } from "~/models";

/**
 * The bluesky HLS materialization: master playlist -> best variant -> MPEG-TS
 * segments -> mux.js transmux -> mp4 blob -> temp-file token. Playlist shapes
 * are live captures from video.bsky.app (2026-11-20).
 */

const transmuxCtx = vi.hoisted(() => {
  const instances: any[] = [];
  return { instances };
});

vi.mock("mux.js", () => ({
  default: {
    mp4: {
      Transmuxer: class {
        handlers: Record<string, ((segment: { data: Uint8Array; initSegment: Uint8Array }) => void)[]> = {};
        pushed: Uint8Array[] = [];
        constructor() {
          transmuxCtx.instances.push(this);
        }
        on(event: string, listener: (segment: { data: Uint8Array; initSegment: Uint8Array }) => void) {
          (this.handlers[event] ??= []).push(listener);
        }
        push(segment: Uint8Array) {
          this.pushed.push(segment);
        }
        flush() {
          for (const listener of this.handlers["data"] ?? []) {
            listener({ data: new Uint8Array([4, 5, 6]), initSegment: new Uint8Array([1, 2, 3]) });
          }
        }
      },
    },
  },
}));

import { materializeResolvedContent, segmentUrlsFromPlaylist, transmuxHlsToMp4Blob, variantPlaylistsFromMaster } from "./resolvedContent";

const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:PROGRAM-ID=0,BANDWIDTH=1097920,AVERAGE-BANDWIDTH=857586,CODECS="avc1.4d401e",RESOLUTION=360x576
360p/video.m3u8?session_id=s1
#EXT-X-STREAM-INF:PROGRAM-ID=0,BANDWIDTH=4123730,AVERAGE-BANDWIDTH=3040382,CODECS="avc1.4d401f",RESOLUTION=720x1152
720p/video.m3u8?session_id=s1
`;

const mediaPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
video0.ts?session_id=s1&dur=6.000000
#EXTINF:3.800,
video1.ts?session_id=s1&dur=3.800000
#EXT-X-ENDLIST
`;

const playlistUrl =
  "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/playlist.m3u8";

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

const makePost = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "post-1",
    resolvedContent: { kind: "hls-mp4", playlistUrl },
    ...overrides,
  }) as unknown as ScrapedPostDetails;

beforeEach(() => {
  transmuxCtx.instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("variantPlaylistsFromMaster", () => {
  it("lists variants best-bandwidth first", () => {
    const variants = variantPlaylistsFromMaster(masterPlaylist, playlistUrl);
    expect(variants).toEqual([
      { url: "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/720p/video.m3u8?session_id=s1", bandwidth: 4123730 },
      { url: "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/360p/video.m3u8?session_id=s1", bandwidth: 1097920 },
    ]);
  });

  it("returns empty for a bare media playlist", () => {
    expect(variantPlaylistsFromMaster(mediaPlaylist, playlistUrl)).toEqual([]);
  });
});

describe("segmentUrlsFromPlaylist", () => {
  it("lists the media segments in order, resolved against the playlist url", () => {
    const segments = segmentUrlsFromPlaylist(mediaPlaylist, "https://video.bsky.app/watch/x/720p/video.m3u8?session_id=s1");
    expect(segments).toEqual([
      "https://video.bsky.app/watch/x/720p/video0.ts?session_id=s1&dur=6.000000",
      "https://video.bsky.app/watch/x/720p/video1.ts?session_id=s1&dur=3.800000",
    ]);
  });
});

describe("transmuxHlsToMp4Blob", () => {
  it("feeds every segment of the best variant through the transmuxer and emits one mp4 blob", async () => {
    const fetchMock = vi.fn(async (url: any) => {
      const target = String(url);
      if (target.endsWith("playlist.m3u8")) return textResponse(masterPlaylist);
      if (target.includes("720p/video.m3u8")) return textResponse(mediaPlaylist);
      return textResponse("TS-BYTES"); // segments
    });
    vi.stubGlobal("fetch", fetchMock);

    const blob = await transmuxHlsToMp4Blob(playlistUrl);

    expect(blob.type).toBe("video/mp4");
    // init segment (from the data event) + one data chunk per fake flush.
    expect(blob.size).toBe(6);

    const transmuxer = transmuxCtx.instances.at(-1)!;
    // Two segments of the 720p (best-bandwidth) variant, never the 360p one.
    expect(transmuxer.pushed).toHaveLength(2);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      playlistUrl,
      "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/720p/video.m3u8?session_id=s1",
      "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/720p/video0.ts?session_id=s1&dur=6.000000",
      "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/720p/video1.ts?session_id=s1&dur=3.800000",
    ]);
  });

  it("uses the playlist itself when it is already a media playlist", async () => {
    const fetchMock = vi.fn(async (url: any) => {
      const target = String(url);
      if (target.includes("video.m3u8")) return textResponse(mediaPlaylist);
      return textResponse("TS");
    });
    vi.stubGlobal("fetch", fetchMock);

    await transmuxHlsToMp4Blob("https://video.bsky.app/watch/x/720p/video.m3u8?session_id=s1");

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://video.bsky.app/watch/x/720p/video.m3u8?session_id=s1",
      "https://video.bsky.app/watch/x/720p/video0.ts?session_id=s1&dur=6.000000",
      "https://video.bsky.app/watch/x/720p/video1.ts?session_id=s1&dur=3.800000",
    ]);
  });

  it("throws when the media playlist has no segments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        if (String(url).endsWith("playlist.m3u8")) return textResponse(masterPlaylist);
        return textResponse("#EXTM3U\n#EXT-X-ENDLIST\n");
      }),
    );

    await expect(transmuxHlsToMp4Blob(playlistUrl)).rejects.toThrow("contains no segments");
  });

  it("throws when a segment fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const target = String(url);
        if (target.endsWith("playlist.m3u8")) return textResponse(masterPlaylist);
        if (target.includes("720p/video.m3u8")) return textResponse(mediaPlaylist);
        return { ok: false, status: 403 } as unknown as Response;
      }),
    );

    await expect(transmuxHlsToMp4Blob(playlistUrl)).rejects.toThrow("status 403");
  });
});

describe("materializeResolvedContent", () => {
  it("uploads the transmuxed blob and returns its token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const target = String(url);
        if (target.endsWith("playlist.m3u8")) return textResponse(masterPlaylist);
        if (target.includes("720p/video.m3u8")) return textResponse(mediaPlaylist);
        return textResponse("TS");
      }),
    );

    const szuru = { uploadTempFileFromBlob: vi.fn().mockResolvedValue({ token: "token-42" }) } as any;
    const token = await materializeResolvedContent(szuru, makePost());

    expect(token).toBe("token-42");
    expect(szuru.uploadTempFileFromBlob).toHaveBeenCalledTimes(1);
    expect(szuru.uploadTempFileFromBlob.mock.calls[0][0].type).toBe("video/mp4");
  });

  it("rejects posts without a resolution plan", async () => {
    const szuru = { uploadTempFileFromBlob: vi.fn() } as unknown as SzurubooruApi;
    await expect(materializeResolvedContent(szuru, makePost({ resolvedContent: undefined }))).rejects.toThrow(
      "no content resolution plan",
    );
    expect((szuru as any).uploadTempFileFromBlob).not.toHaveBeenCalled();
  });
});
