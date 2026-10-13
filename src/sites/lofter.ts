import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Lofter engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Lofter.ts @ efcea42.
// TODO: that engine's canImport uses computed host logic (any <sub>.lofter.com
// blog subdomain) instead of the literal supportedHosts entry; the derived
// matcher already covers subdomains of lofter.com.
const hosts = ["lofter.com"];

const lofter: SiteAdapter = {
  id: "lofter",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default lofter;
