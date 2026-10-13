import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Shuushuu engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Shuushuu.ts @ efcea42.
const hosts = ["e-shuushuu.net"];

const shuushuu: SiteAdapter = {
  id: "shuushuu",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default shuushuu;
