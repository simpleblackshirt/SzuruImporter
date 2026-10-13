import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Inkbunny engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Inkbunny.ts @ efcea42.
const hosts = ["inkbunny.net"];

const inkbunny: SiteAdapter = {
  id: "inkbunny",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default inkbunny;
