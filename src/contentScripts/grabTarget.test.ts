import { describe, expect, it } from "vitest";
// @ts-expect-error jsdom ships no type declarations consumed by this repo's tsconfig.
import { JSDOM } from "jsdom";
import { mediaUrlsMatch, resolveGrabTarget } from "./grabTarget";

// Mirror of the live tweet shape: media img inside the tweet article, plus a
// stale (re-render-replaced) node that is no longer in the document.
function fixture() {
  const dom = new JSDOM(`<html><body>
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/ArtistOne"><span>Artist One</span></a></div>
      <a role="link" href="/ArtistOne/status/111/photo/1">
        <div data-testid="tweetPhoto"><img id="live" src="https://pbs.twimg.com/media/HU1?format=jpg&amp;name=small"></div>
      </a>
    </article>
  </body></html>`);
  const stale = dom.window.document.createElement("img");
  stale.src = "https://pbs.twimg.com/media/HU1?format=jpg&name=small";
  return { doc: dom.window.document, stale };
}

describe("mediaUrlsMatch", () => {
  it("matches on origin + path, ignoring rendition params", () => {
    expect(mediaUrlsMatch("https://pbs.twimg.com/media/HU1?format=jpg&name=small", "https://pbs.twimg.com/media/HU1?format=jpg&name=orig")).toBe(true);
    expect(mediaUrlsMatch("https://pbs.twimg.com/media/HU1", "https://pbs.twimg.com/media/HU1?format=jpg")).toBe(true);
  });

  it("does not match a different media id or host", () => {
    expect(mediaUrlsMatch("https://pbs.twimg.com/media/HU1", "https://pbs.twimg.com/media/XYZ")).toBe(false);
    expect(mediaUrlsMatch("https://pbs.twimg.com/media/HU1", "https://evil.example/media/HU1")).toBe(false);
  });

  it("rejects unparseable urls", () => {
    expect(mediaUrlsMatch("not a url", "https://pbs.twimg.com/media/HU1")).toBe(false);
  });
});

describe("resolveGrabTarget", () => {
  const srcUrl = "https://pbs.twimg.com/media/HU1?format=jpg&name=small";

  it("returns a connected candidate untouched (fallback not consulted)", () => {
    const { doc, stale } = fixture();
    const connected = doc.querySelector("#live")!;

    expect(resolveGrabTarget(connected, "https://pbs.twimg.com/media/other", doc)).toBe(connected);
    // Sanity: the stale node would NOT have matched this srcUrl.
    expect(stale.isConnected).toBe(false);
  });

  it("revives the target from the menu's media url when the candidate is disconnected", () => {
    const { doc, stale } = fixture();

    const resolved = resolveGrabTarget(stale, srcUrl, doc);
    expect(resolved?.isConnected).toBe(true);
    expect(resolved?.id).toBe("live");
  });

  it("revives across rendition param changes (name=small vs name=orig)", () => {
    const { doc, stale } = fixture();

    expect(resolveGrabTarget(stale, "https://pbs.twimg.com/media/HU1?format=jpg&name=orig", doc)?.id).toBe("live");
  });

  it("keeps the bail behavior when nothing matches", () => {
    const { doc, stale } = fixture();

    expect(resolveGrabTarget(stale, "https://pbs.twimg.com/media/other", doc)).toBeUndefined();
    expect(resolveGrabTarget(stale, undefined, doc)).toBeUndefined();
    expect(resolveGrabTarget(undefined, undefined, doc)).toBeUndefined();
  });

  it("prefers the connected candidate even when a same-url img exists elsewhere", () => {
    const { doc } = fixture();

    const elsewhere = doc.createElement("img");
    elsewhere.src = srcUrl;
    doc.body.appendChild(elsewhere);
    const inArticle = doc.querySelector("#live")!;

    expect(resolveGrabTarget(inArticle, srcUrl, doc)).toBe(inArticle);
    expect(elsewhere.isConnected).toBe(true);
    doc.body.removeChild(elsewhere);
  });
});
