import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Shimmie2 engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Shimmie2.ts @ efcea42.
const hosts = ["rule34.paheal.net", "rule34hentai.net"];

const shimmie2: SiteAdapter = {
  id: "shimmie2",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default shimmie2;
