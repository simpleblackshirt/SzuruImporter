import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Pixiv engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Pixiv.ts @ efcea42.
const hosts = ["pixiv.net"];

const pixiv: SiteAdapter = {
  id: "pixiv",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default pixiv;
