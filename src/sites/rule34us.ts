import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Rule34us engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Rule34us.ts @ efcea42.
const hosts = ["rule34.us"];

const rule34us: SiteAdapter = {
  id: "rule34us",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default rule34us;
