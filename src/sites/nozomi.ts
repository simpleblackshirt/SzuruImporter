import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Nozomi engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Nozomi.ts @ efcea42.
const hosts = ["nozomi.la"];

const nozomi: SiteAdapter = {
  id: "nozomi",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default nozomi;
