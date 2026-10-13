import { hostsToMatchUrl, type SourceUrlFamily } from "./identity";
import type { SiteAdapter } from "./index";

// Page hosts scraped by the neo-scraper Twitter engine (its supportedHosts).
// Host data copied from neo-scraper src/engines/Twitter.ts @ efcea42.
const hosts = ["twitter.com", "mobile.twitter.com", "x.com"];

// The same status is served on x.com and twitter.com with the status id as
// the anchored last path segment.
const sourceFamilies: SourceUrlFamily[] = [{ hosts: ["x.com", "twitter.com"], idPath: /\/status\/[^/]+$/ }];

const twitter: SiteAdapter = {
  id: "twitter",
  hosts,
  matchUrl: hostsToMatchUrl(hosts),
  sourceFamilies,
};

export default twitter;
