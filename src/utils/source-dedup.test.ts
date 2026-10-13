import { describe, expect, it } from "vitest";
import { appendPageUrlToSource, mergeSources, normalizeSourceUrl, urlsReferToSamePost } from "../utils";

// Approved dual-line rednote source format: line 1 is the browsed href captured
// byte-for-byte (xsec_token verbatim, trailing %3D kept), line 2 the tokenless
// canonical explore url as the stable-identity provenance line (it 404s standalone).
const rednoteNoteId = "6ac3c331000000000b004539";
const rednoteTokenedHref = `https://www.rednote.com/discovery/item/${rednoteNoteId}?xsec_token=CB0abc123%3D&xsec_source=pc_feed`;
const rednoteCanonical = `https://www.xiaohongshu.com/explore/${rednoteNoteId}`;
const rednoteDualLine = `${rednoteTokenedHref}\n${rednoteCanonical}`;
// Modal view of the same note opened from a profile page (xsec_source=pc_user).
const rednoteModalPageUrl = `https://www.xiaohongshu.com/user/profile/5ff0e6410000000001008400/${rednoteNoteId}?xsec_token=CB0abc123%3D&xsec_source=pc_user`;

describe("appendPageUrlToSource", () => {
  const pageUrl = "https://www.pixiv.net/en/artworks/93964654";

  it("should append the page url to an empty source", () => {
    expect(appendPageUrlToSource("", pageUrl, false)).toBe(pageUrl);
  });

  it("should append the page url to an empty source when addPageUrlToSource is absent", () => {
    expect(appendPageUrlToSource("", pageUrl)).toBe(pageUrl);
  });

  it("should append the page url when addPageUrlToSource is enabled", () => {
    expect(appendPageUrlToSource("https://example.com/other", pageUrl, true)).toBe(
      `https://example.com/other\n${pageUrl}`,
    );
  });

  it("should not duplicate the page url when it is already the only source line", () => {
    // Engines like twitter/pixiv/lofter already emit the page url as source.
    const out = appendPageUrlToSource(pageUrl, pageUrl, true);
    expect(out.split("\n").filter((line) => line == pageUrl).length).toBe(1);
  });

  it("should not duplicate the page url when it is one of multiple source lines", () => {
    const out = appendPageUrlToSource(`${pageUrl}\nhttps://example.com/other`, pageUrl, true);
    expect(out.split("\n").filter((line) => line == pageUrl).length).toBe(1);
    expect(out.split("\n")).toHaveLength(2);
  });

  it("should not append when addPageUrlToSource is disabled and the source is non-empty", () => {
    expect(appendPageUrlToSource("https://example.com/other", pageUrl, false)).toBe("https://example.com/other");
  });

  describe("normalization-aware dedup (unconditional of addPageUrlToSource)", () => {
    const variantClasses: { name: string; source: string; pageUrl: string }[] = [
      {
        // Pixiv emits a canonical/locale-less artwork url while the page url contains a locale segment.
        name: "pixiv locale variant",
        source: "https://www.pixiv.net/artworks/93964654",
        pageUrl: "https://www.pixiv.net/en/artworks/93964654",
      },
      {
        // Lofter emits origin + pathname, the page url may carry query and hash.
        name: "lofter query/hash variant",
        source: "https://someuser.lofter.com/post/1e59bdc5_12f66dc85",
        pageUrl: "https://someuser.lofter.com/post/1e59bdc5_12f66dc85?from=latest#post-detail",
      },
      {
        // Rednote serves the same note id on another host with another path layout and query params.
        name: "rednote cross-host same note id",
        source: "https://www.xiaohongshu.com/explore/667a1b2c000000000e00c199",
        pageUrl:
          "https://www.rednote.com/discovery/item/667a1b2c000000000e00c199?xsec_token=ABc123&xsec_source=pc_like",
      },
      {
        // Twitter status url emitted without query, page url carries ?s=20.
        name: "twitter query variant",
        source: "https://x.com/someuser/status/1234567890",
        pageUrl: "https://x.com/someuser/status/1234567890?s=20",
      },
      {
        // Twitter status url with www host.
        name: "twitter www variant",
        source: "https://x.com/someuser/status/1234567890",
        pageUrl: "https://www.x.com/someuser/status/1234567890",
      },
      {
        // Twitter status url on the old twitter.com host.
        name: "twitter cross-host variant",
        source: "https://x.com/someuser/status/1234567890",
        pageUrl: "https://twitter.com/someuser/status/1234567890",
      },
    ];

    for (const variant of variantClasses) {
      it(`should not duplicate the ${variant.name} with addPageUrlToSource enabled`, () => {
        expect(appendPageUrlToSource(variant.source, variant.pageUrl, true)).toBe(variant.source);
      });

      it(`should not duplicate the ${variant.name} with addPageUrlToSource disabled`, () => {
        expect(appendPageUrlToSource(variant.source, variant.pageUrl, false)).toBe(variant.source);
      });

      it(`should not duplicate the ${variant.name} with addPageUrlToSource absent`, () => {
        expect(appendPageUrlToSource(variant.source, variant.pageUrl)).toBe(variant.source);
      });
    }

    it("should not duplicate the page url hidden in a multi-line source", () => {
      const source = "https://example.com/other\nhttps://www.pixiv.net/artworks/93964654";
      expect(appendPageUrlToSource(source, "https://www.pixiv.net/en/artworks/93964654", true)).toBe(source);
    });

    it("should detect the duplicate regardless of argument order", () => {
      // The page url variant might already be the source and the engine form gets appended.
      const source = "https://www.pixiv.net/en/artworks/93964654";
      expect(appendPageUrlToSource(source, "https://www.pixiv.net/artworks/93964654", true)).toBe(source);
    });

    it("should append a genuinely distinct pixiv url with the same numeric id", () => {
      // /artworks/93964654 and /users/93964654 are different posts; pixiv is not in a host family.
      const out = appendPageUrlToSource(
        "https://www.pixiv.net/artworks/93964654",
        "https://www.pixiv.net/en/users/93964654",
        true,
      );
      expect(out.split("\n")).toHaveLength(2);
    });

    it("should append a genuinely distinct tweet", () => {
      const out = appendPageUrlToSource(
        "https://x.com/someuser/status/1234567890",
        "https://x.com/someuser/status/9876543210?s=20",
        true,
      );
      expect(out.split("\n")).toHaveLength(2);
    });

    it("should append a genuinely distinct lofter post", () => {
      const out = appendPageUrlToSource(
        "https://someuser.lofter.com/post/1e59bdc5_12f66dc85",
        "https://otheruser.lofter.com/post/aaaabbbb_00001111",
        true,
      );
      expect(out.split("\n")).toHaveLength(2);
    });

    it("should not treat hosts of different site families with equal ids as the same post", () => {
      const out = appendPageUrlToSource(
        "https://www.xiaohongshu.com/explore/667a1b2c000000000e00c199",
        "https://x.com/someuser/status/667a1b2c000000000e00c199",
        true,
      );
      expect(out.split("\n")).toHaveLength(2);
    });
  });

  describe("dual-line rednote source", () => {
    it("should keep both lines once each when the page url matches the browsed line", () => {
      const out = appendPageUrlToSource(rednoteDualLine, rednoteTokenedHref, true);
      expect(out.split("\n")).toEqual([rednoteTokenedHref, rednoteCanonical]);
    });

    it("should keep both lines when the page url is the profile-modal form of the same note", () => {
      // The page url is the modal note view under /user/profile/<uid>/; matching it
      // against the browsed feed href relies on the family-anchored note id, not equality.
      const out = appendPageUrlToSource(rednoteDualLine, rednoteModalPageUrl, true);
      expect(out.split("\n")).toEqual([rednoteTokenedHref, rednoteCanonical]);
    });
  });
});

describe("normalizeSourceUrl", () => {
  it("should lowercase the host and strip www, query, hash and trailing slash", () => {
    expect(normalizeSourceUrl("https://WWW.Example.com/Path/?a=1#frag")).toBe("example.com/Path");
    expect(normalizeSourceUrl("https://www.xiaohongshu.com/explore/123?xsec_token=AB")).toBe(
      "xiaohongshu.com/explore/123",
    );
  });

  it("should drop a locale path segment directly after the host", () => {
    expect(normalizeSourceUrl("https://www.pixiv.net/en/artworks/93964654")).toBe("pixiv.net/artworks/93964654");
    expect(normalizeSourceUrl("https://www.pixiv.net/ja/artworks/93964654")).toBe("pixiv.net/artworks/93964654");
    expect(normalizeSourceUrl("https://www.pixiv.net/zh-cn/artworks/93964654")).toBe("pixiv.net/artworks/93964654");
  });

  it("should keep a locale-like first segment when the path has no other segments", () => {
    // "/en" alone might be a real page; only strip a locale in front of other segments.
    expect(normalizeSourceUrl("https://example.com/en")).toBe("example.com/en");
  });

  it("should keep non-locale first segments", () => {
    expect(normalizeSourceUrl("https://someuser.lofter.com/post/1e59bdc5_12f66dc85")).toBe(
      "someuser.lofter.com/post/1e59bdc5_12f66dc85",
    );
  });

  it("should leave non-parsable input unchanged", () => {
    expect(normalizeSourceUrl("")).toBe("");
    expect(normalizeSourceUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("urlsReferToSamePost", () => {
  it("should match urls that normalize to the same url", () => {
    expect(urlsReferToSamePost("https://www.pixiv.net/en/artworks/1#x", "https://pixiv.net/artworks/1?i=2")).toBe(true);
  });

  it("should match same-post ids across hosts of the same site family", () => {
    expect(urlsReferToSamePost("https://x.com/a/status/1", "https://twitter.com/b/status/1")).toBe(true);
    expect(
      urlsReferToSamePost(
        "https://www.xiaohongshu.com/explore/667a1b2c000000000e00c199",
        "https://www.rednote.com/discovery/item/667a1b2c000000000e00c199?xsec_token=AB",
      ),
    ).toBe(true);
    expect(urlsReferToSamePost("https://x.com/i/web/status/1", "https://x.com/a/status/1")).toBe(true);
  });

  it("should match rednote note ids across the explore, note and discovery/item path forms", () => {
    expect(
      urlsReferToSamePost(rednoteCanonical, `https://www.xiaohongshu.com/note/${rednoteNoteId}?xsec_token=AB`),
    ).toBe(true);
    expect(urlsReferToSamePost(rednoteCanonical, `https://www.rednote.com/discovery/item/${rednoteNoteId}`)).toBe(true);
  });

  it("should match the profile-modal note url form with the canonical explore url", () => {
    // /user/profile/<uid>/<noteId> anchors the note id as the last path segment; a bare
    // /user/profile/<uid> page (see the distinct-posts test above) and a different note
    // id stay unmatched.
    expect(urlsReferToSamePost(rednoteCanonical, rednoteModalPageUrl)).toBe(true);
    expect(
      urlsReferToSamePost(
        rednoteCanonical,
        "https://www.xiaohongshu.com/user/profile/5ff0e6410000000001008400/000000000000000000000000",
      ),
    ).toBe(false);
  });

  it("should not match distinct posts in the same family", () => {
    expect(urlsReferToSamePost("https://x.com/a/status/1", "https://twitter.com/a/status/2")).toBe(false);
    expect(
      urlsReferToSamePost("https://www.xiaohongshu.com/explore/111", "https://www.rednote.com/user/profile/111"),
    ).toBe(false);
  });

  it("should not match ids across different site families", () => {
    expect(urlsReferToSamePost("https://www.pixiv.net/artworks/1", "https://www.pixiv.net/users/1")).toBe(false);
    expect(urlsReferToSamePost("https://www.xiaohongshu.com/explore/1", "https://x.com/a/status/1")).toBe(false);
  });

  it("should not match urls without a path", () => {
    expect(urlsReferToSamePost("https://x.com", "https://twitter.com")).toBe(false);
  });
});

describe("mergeSources", () => {
  it("should merge scraped lines into the existing source", () => {
    expect(mergeSources("https://example.com/a", "https://example.com/b")).toBe(
      "https://example.com/a\nhttps://example.com/b",
    );
  });

  it("should not merge an exact duplicate line", () => {
    // Guards the plain exact-match dedup that the utils guard replaced.
    expect(mergeSources("https://example.com/a\nhttps://example.com/b", "https://example.com/b")).toBe(
      "https://example.com/a\nhttps://example.com/b",
    );
  });

  it("should not merge a form-variant duplicate of an existing source", () => {
    // MergePost appendSources matched exact strings only, so the locale-less
    // engine form and the /en/ page form both ended up in the merged source.
    expect(mergeSources("https://www.pixiv.net/artworks/93964654", "https://www.pixiv.net/en/artworks/93964654")).toBe(
      "https://www.pixiv.net/artworks/93964654",
    );
  });

  it("should not merge a rednote cross-host variant with the same note id", () => {
    expect(
      mergeSources(
        "https://www.xiaohongshu.com/explore/667a1b2c000000000e00c199",
        "https://www.rednote.com/discovery/item/667a1b2c000000000e00c199?xsec_token=AB",
      ),
    ).toBe("https://www.xiaohongshu.com/explore/667a1b2c000000000e00c199");
  });

  it("should merge genuinely distinct urls even with equal last path segments", () => {
    // pixiv is not in a host family: /artworks/<id> vs /users/<id> are different posts.
    expect(
      mergeSources("https://www.pixiv.net/artworks/93964654", "https://www.pixiv.net/en/users/93964654").split("\n"),
    ).toHaveLength(2);
  });

  it("should merge into an absent existing source without a leading empty line", () => {
    expect(mergeSources(undefined, "https://example.com/a")).toBe("https://example.com/a");
  });

  describe("dual-line rednote source", () => {
    it("should keep both lines when merging into an absent existing source", () => {
      expect(mergeSources(undefined, rednoteDualLine)).toBe(rednoteDualLine);
    });

    it("should collapse identical dual-line input to the same two lines", () => {
      expect(mergeSources(rednoteDualLine, rednoteDualLine)).toBe(rednoteDualLine);
    });

    it("should keep both lines when the scraped source repeats one of them", () => {
      expect(mergeSources(rednoteDualLine, rednoteCanonical)).toBe(rednoteDualLine);
    });

    it("should not append a re-scraped feed variant of an already stored modal-form note", () => {
      // Stored from a profile-modal browse, re-scraped from the feed surface. Without
      // the modal path form in the family anchor, the tokened feed href appends a
      // third line for the same note.
      const stored = `${rednoteModalPageUrl}\n${rednoteCanonical}`;
      const rescraped = `https://www.rednote.com/discovery/item/${rednoteNoteId}?xsec_token=DD9xyz789%3D&xsec_source=pc_search\n${rednoteCanonical}`;
      expect(mergeSources(stored, rescraped)).toBe(stored);
    });
  });
});
