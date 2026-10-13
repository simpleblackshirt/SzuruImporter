import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper SankakuComplex engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/SankakuComplex.ts @ efcea42.
const hosts = ["chan.sankakucomplex.com"];

const sankakuComplex: SiteAdapter = {
  id: "sankaku-complex",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default sankakuComplex;
