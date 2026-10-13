import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Philomena engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Philomena.ts @ efcea42.
const hosts = [
  "derpibooru.org",
  "trixiebooru.org",
  "ponybooru.org",
  "furbooru.org",
  "ponerpics.org",
  "manebooru.art",
  "twibooru.org",
];

const philomena: SiteAdapter = {
  id: "philomena",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default philomena;
