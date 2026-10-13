import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Reddit engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Reddit.ts @ efcea42.
const hosts = ["reddit.com", "new.reddit.com", "old.reddit.com"];

const reddit: SiteAdapter = {
  id: "reddit",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default reddit;
