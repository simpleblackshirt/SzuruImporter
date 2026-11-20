/**
 * Minimal typings for the mux.js subset the extension uses (HLS MPEG-TS ->
 * fragmented mp4 transmuxing in the background; bluesky video support).
 */
declare module "mux.js" {
  interface TransmuxSegment {
    data: Uint8Array;
    initSegment: Uint8Array;
  }

  interface Transmuxer {
    on(event: "data", listener: (segment: TransmuxSegment) => void): void;
    push(segment: Uint8Array): void;
    flush(): void;
    reset(): void;
  }

  const mux: {
    mp4: {
      Transmuxer: new (options?: { keepOriginalTimestamps?: boolean }) => Transmuxer;
    };
  };

  export default mux;
}
