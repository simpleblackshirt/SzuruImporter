import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Zerochan engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Zerochan.ts @ efcea42.
const hosts = ["zerochan.net"];

const zerochan: SiteAdapter = {
  id: "zerochan",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default zerochan;
