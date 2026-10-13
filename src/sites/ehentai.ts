import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Ehentai engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Ehentai.ts @ efcea42.
const hosts = ["e-hentai.org", "exhentai.org"];

const ehentai: SiteAdapter = {
  id: "ehentai",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default ehentai;
