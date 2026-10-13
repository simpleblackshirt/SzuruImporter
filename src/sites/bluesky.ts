import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Bluesky engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Bluesky.ts @ efcea42.
const hosts = ["bsky.app"];

const bluesky: SiteAdapter = {
  id: "bluesky",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default bluesky;
