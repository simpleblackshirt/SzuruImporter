import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper FurAffinity engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/FurAffinity.ts @ efcea42.
const hosts = ["furaffinity.net"];

const furaffinity: SiteAdapter = {
  id: "furaffinity",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default furaffinity;
