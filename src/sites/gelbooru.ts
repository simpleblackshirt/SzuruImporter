import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Gelbooru engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Gelbooru.ts @ efcea42.
const hosts = ["safebooru.org", "gelbooru.com", "rule34.xxx", "tbib.org", "xbooru.com", "mspabooru.com", "hypnohub.net"];

const gelbooru: SiteAdapter = {
  id: "gelbooru",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default gelbooru;
