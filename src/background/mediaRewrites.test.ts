import { describe, expect, it } from "vitest";
import { rewriteMediaUrl } from "./mediaRewrites";

/** The tier-1 resolvers produce one engine-labeled result with one post. */
const singlePost = (res: ReturnType<typeof rewriteMediaUrl>) => {
  expect(res?.results).toHaveLength(1);
  expect(res?.results[0].posts).toHaveLength(1);
  return res!.results[0].posts[0];
};

describe("rewriteMediaUrl: twitter", () => {
  it("upgrades raw pbs media urls to name=orig", () => {
    const res = rewriteMediaUrl("https://pbs.twimg.com/media/abc123?format=jpg&name=small", "");
    const post = singlePost(res);
    expect(res?.results[0].engine).toBe("twitter");
    expect(post.contentUrl).toBe("https://pbs.twimg.com/media/abc123?format=jpg&name=orig");
    // pbs 403s szuru-server-side fetches - same as element grabs.
    expect(post.uploadMode).toBe("content");
  });

  it("carries the page url when grabbed on twitter itself", () => {
    const res = rewriteMediaUrl("https://pbs.twimg.com/media/abc123?format=jpg&name=small", "https://x.com/someone/status/123");
    const post = singlePost(res);
    expect(post.pageUrl).toBe("https://x.com/someone/status/123");
  });

  it("drops the page url on a raw CDN tab (it IS the media url)", () => {
    const url = "https://pbs.twimg.com/media/abc123?format=jpg&name=small";
    const post = singlePost(rewriteMediaUrl(url, url));
    expect(post.pageUrl).toBe("");
  });

  it("ignores non-media pbs paths (avatars, profile images)", () => {
    expect(rewriteMediaUrl("https://pbs.twimg.com/profile_images/9/10_normal.jpg", "")).toBeUndefined();
  });
});

describe("rewriteMediaUrl: weibo", () => {
  it("upgrades rendition dirs to /large/", () => {
    const res = rewriteMediaUrl("https://wx1.sinaimg.cn/mw2000/abc/def.jpg", "");
    const post = singlePost(res);
    expect(res?.results[0].engine).toBe("weibo");
    expect(post.contentUrl).toBe("https://wx1.sinaimg.cn/large/abc/def.jpg");
    expect(post.uploadMode).toBe("content");
  });

  it("passes /large/ urls through as-is", () => {
    const post = singlePost(rewriteMediaUrl("https://wx1.sinaimg.cn/large/abc/def.jpg", ""));
    expect(post.contentUrl).toBe("https://wx1.sinaimg.cn/large/abc/def.jpg");
  });
});

describe("rewriteMediaUrl: lofter", () => {
  it("strips the image-processing query for original quality", () => {
    const res = rewriteMediaUrl(
      "https://imglf5.lf127.net/img/abc/Q0Rp.jpg?imageView&thumbnail=1680x0&quality=96&stripmeta=0",
      "",
    );
    const post = singlePost(res);
    expect(res?.results[0].engine).toBe("lofter");
    expect(post.contentUrl).toBe("https://imglf5.lf127.net/img/abc/Q0Rp.jpg");
    // No known lofter hotlink protection.
    expect(post.uploadMode).toBe("url");
  });
});

describe("rewriteMediaUrl: bluesky", () => {
  it("rewrites feed_thumbnail to feed_fullsize", () => {
    const res = rewriteMediaUrl(
      "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:x/bafkreiabc@jpeg",
      "",
    );
    const post = singlePost(res);
    expect(res?.results[0].engine).toBe("bluesky");
    expect(post.contentUrl).toBe("https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:x/bafkreiabc@jpeg");
    expect(post.uploadMode).toBe("url");
  });

  it("ignores non-thumbnail cdn.bsky.app paths", () => {
    expect(rewriteMediaUrl("https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkreiabc@jpeg", "")).toBeUndefined();
  });
});

describe("rewriteMediaUrl: non-matching targets", () => {
  it("returns undefined for foreign hosts", () => {
    expect(rewriteMediaUrl("https://example.com/cat.jpg", "")).toBeUndefined();
  });

  it("returns undefined for missing or unparseable urls", () => {
    expect(rewriteMediaUrl(undefined, "")).toBeUndefined();
    expect(rewriteMediaUrl("", "")).toBeUndefined();
    expect(rewriteMediaUrl("not a url", "")).toBeUndefined();
  });
});
