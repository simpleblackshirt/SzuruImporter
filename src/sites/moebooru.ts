import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Moebooru engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Moebooru.ts @ efcea42.
const hosts = ["yande.re", "konachan.com", "konachan.net", "sakugabooru.com", "img.genshiken-itb.org"];

const moebooru: SiteAdapter = {
  id: "moebooru",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default moebooru;
