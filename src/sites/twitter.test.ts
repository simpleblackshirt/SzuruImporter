import { describe, expect, it } from "vitest";
import twitter from "./twitter";

describe("twitter site adapter", () => {
  it("should declare the page hosts of the neo-scraper Twitter engine", () => {
    // Host data copied from neo-scraper src/engines/Twitter.ts @ efcea42.
    expect(twitter.hosts).toEqual(["twitter.com", "mobile.twitter.com", "x.com"]);
  });

  it("should carry the status family for x.com/twitter.com source dedup", () => {
    // Relocated verbatim from the former utils POST_ID_FAMILIES entry.
    expect(twitter.sourceFamilies).toEqual([{ hosts: ["x.com", "twitter.com"], idPath: /\/status\/[^/]+$/ }]);
  });
});
