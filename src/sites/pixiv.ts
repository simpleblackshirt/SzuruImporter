import { hostsToMatchUrl } from "./identity";
import type { RefererRule, SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Pixiv engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Pixiv.ts @ efcea42.
const hosts = ["pixiv.net"];

// Pixiv's i.pximg.net CDN answers 403 for image requests without a pixiv
// Referer (hotlink protection).
const pximgUrlRegex = /^https?:\/\/[^/]*\.pximg\.net\//;

const pixiv: SiteAdapter = {
  id: "pixiv",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
  refererRule: {
    urlFilter: ["*://*.i.pximg.net/*"],
    urlPattern: pximgUrlRegex,
    requestDomains: ["pximg.net"],
    referer: "https://pixiv.net/",
    // Attach the Referer only for requests initiated by our own extension
    // pages/background - never for requests from normal web browsing.
    extensionInitiatedOnly: true,
  } satisfies RefererRule,
};

export default pixiv;
