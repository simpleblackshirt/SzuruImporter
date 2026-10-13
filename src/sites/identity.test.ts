import { describe, expect, it } from "vitest";
import { hostsToMatchUrl, samePostInFamily, type SourceUrlFamily } from "./identity";

describe("hostsToMatchUrl", () => {
  const matchUrl = hostsToMatchUrl(["e621.net", "e926.net"]);

  it("should match page urls on the listed hosts with and without a subdomain", () => {
    for (const host of ["e621.net", "e926.net"]) {
      expect(matchUrl.test(`https://${host}/posts/1`)).toBe(true);
      expect(matchUrl.test(`https://www.${host}/posts/1`)).toBe(true);
      expect(matchUrl.test(`https://cdn.${host}/posts/1`)).toBe(true);
    }
  });

  it("must not match lookalike hosts that only contain a listed host as dotless substring", () => {
    // Failure mode: unescaped dots in the derived pattern would turn "e621.net"
    // into a wildcard also matching lookalike host names.
    expect(matchUrl.test("https://e621net.org/posts/1")).toBe(false);
    expect(matchUrl.test("https://pre621.net/posts/1")).toBe(false);
  });

  it("must not match foreign hosts", () => {
    expect(matchUrl.test("https://example.com/posts/1")).toBe(false);
  });
});

describe("samePostInFamily", () => {
  const family: SourceUrlFamily = { hosts: ["a.example.com", "b.example.com"], idPath: /\/posts\/[^/]+$/ };

  it("should match equal anchored ids across the family's hosts", () => {
    expect(samePostInFamily(family, "a.example.com", "/posts/1", "b.example.com", "/x/posts/1")).toBe(true);
  });

  it("must not match when either path does not anchor the id as its last segment", () => {
    // Failure mode: an idPath without the $-anchor semantics would treat a bare
    // profile page with a coincidentally equal last segment as the same post.
    expect(samePostInFamily(family, "a.example.com", "/posts/1", "b.example.com", "/posts/1/extra")).toBe(false);
  });

  it("must not match different ids", () => {
    expect(samePostInFamily(family, "a.example.com", "/posts/1", "b.example.com", "/posts/2")).toBe(false);
  });

  it("must not match hosts outside the family", () => {
    expect(samePostInFamily(family, "a.example.com", "/posts/1", "c.example.com", "/posts/1")).toBe(false);
  });
});
