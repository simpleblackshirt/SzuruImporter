import { hostsToMatchUrl } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper AnimePictures engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/AnimePictures.ts @ efcea42.
const hosts = ["anime-pictures.net"];

const animePictures: SiteAdapter = {
  id: "anime-pictures",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
};

export default animePictures;
