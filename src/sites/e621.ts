import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper e621 engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/e621.ts @ efcea42.
const hosts = ["e621.net", "e926.net", "e6ai.net"];

const e621: SiteAdapter = {
  id: "e621",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default e621;
