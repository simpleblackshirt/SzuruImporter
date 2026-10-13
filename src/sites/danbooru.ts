import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Danbooru engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Danbooru.ts @ efcea42.
const hosts = ["danbooru.donmai.us", "safebooru.donmai.us", "sonohara.donmai.us", "hijiribe.donmai.us"];

const danbooru: SiteAdapter = {
  id: "danbooru",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default danbooru;
