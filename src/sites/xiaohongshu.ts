import { hostsToMatchUrl, type SourceUrlFamily } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Xiaohongshu engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Xiaohongshu.ts @ efcea42.
const hosts = ["xiaohongshu.com", "rednote.com"];

// The same note is served on xiaohongshu.com and rednote.com with different
// path layouts. The idPath anchors the note id as the last path segment, so
// the profile-modal note url (/user/profile/<uid>/<noteId>) keeps the note id
// as the anchored last segment.
const sourceFamilies: SourceUrlFamily[] = [
  {
    hosts: ["xiaohongshu.com", "rednote.com"],
    idPath: /\/(explore|note|discovery\/item|user\/profile\/[^/]+)\/[^/]+$/,
  },
];

const xiaohongshu: SiteAdapter = {
  id: "xiaohongshu",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
  sourceFamilies,
};

export default xiaohongshu;
