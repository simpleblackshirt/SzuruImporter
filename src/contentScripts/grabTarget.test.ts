import { describe, expect, it } from "vitest";
import { mediaSrcFromTarget, mediaUrlsMatch, resolveGrabTarget } from "./grabTarget";

// Uses the vitest jsdom environment's own document: mediaSrcFromTarget and
// resolveGrabTarget must operate in the same DOM realm as the elements for
// instanceof/isConnected to hold (a separate new JSDOM() realm would not).

function elementFrom(html: string): Element {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  return wrapper.firstElementChild!;
}

// Mirror of the live tweet shape: media img inside the tweet article, plus a
// stale (re-render-replaced) node that is no longer in the document.
function fixture() {
  document.body.innerHTML = `
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/ArtistOne"><span>Artist One</span></a></div>
      <a role="link" href="/ArtistOne/status/111/photo/1">
        <div data-testid="tweetPhoto"><img id="live" src="https://pbs.twimg.com/media/HU1?format=jpg&amp;name=small"></div>
      </a>
    </article>`;
  const stale = document.createElement("img");
  stale.src = "https://pbs.twimg.com/media/HU1?format=jpg&name=small";
  return { stale, live: document.querySelector("#live")! };
}

describe("mediaSrcFromTarget", () => {
  it("returns the src of an image target", () => {
    expect(mediaSrcFromTarget(elementFrom(`<img src="https://pbs.twimg.com/media/HU1?format=jpg&name=small">`))).toBe(
      "https://pbs.twimg.com/media/HU1?format=jpg&name=small",
    );
  });

  it("returns undefined for an image without a usable src", () => {
    expect(mediaSrcFromTarget(elementFrom(`<img>`))).toBeUndefined();
    expect(mediaSrcFromTarget(elementFrom(`<img src="">`))).toBeUndefined();
  });

  it("returns the poster of a video target", () => {
    expect(
      mediaSrcFromTarget(elementFrom(`<video poster="https://pbs.twimg.com/amplify_video_thumb/1/img/x.jpg">`)),
    ).toBe("https://pbs.twimg.com/amplify_video_thumb/1/img/x.jpg");
    expect(mediaSrcFromTarget(elementFrom(`<video></video>`))).toBeUndefined();
  });

  it("returns undefined for non-media targets", () => {
    expect(mediaSrcFromTarget(elementFrom(`<div></div>`))).toBeUndefined();
    expect(mediaSrcFromTarget(elementFrom(`<a href="/x"><span>t</span></a>`))).toBeUndefined();
    expect(mediaSrcFromTarget(null)).toBeUndefined();
  });
});

describe("mediaUrlsMatch", () => {
  it("matches on origin + path, ignoring rendition params", () => {
    expect(
      mediaUrlsMatch(
        "https://pbs.twimg.com/media/HU1?format=jpg&name=small",
        "https://pbs.twimg.com/media/HU1?format=jpg&name=orig",
      ),
    ).toBe(true);
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
    const { live } = fixture();

    expect(resolveGrabTarget(live, "https://pbs.twimg.com/media/other", document)).toBe(live);
  });

  it("revives the target from the tracked media url when the candidate is disconnected", () => {
    const { stale, live } = fixture();

    const resolved = resolveGrabTarget(stale, srcUrl, document);
    expect(resolved?.isConnected).toBe(true);
    expect(resolved).toBe(live);
  });

  it("revives across rendition param changes (name=small vs name=orig)", () => {
    const { stale, live } = fixture();

    expect(resolveGrabTarget(stale, "https://pbs.twimg.com/media/HU1?format=jpg&name=orig", document)).toBe(live);
  });

  it("keeps the bail behavior when nothing matches", () => {
    const { stale } = fixture();

    expect(resolveGrabTarget(stale, "https://pbs.twimg.com/media/other", document)).toBeUndefined();
    expect(resolveGrabTarget(stale, undefined, document)).toBeUndefined();
    expect(resolveGrabTarget(undefined, undefined, document)).toBeUndefined();
  });

  it("prefers the connected candidate even when a same-url img exists elsewhere", () => {
    const { live } = fixture();

    const elsewhere = document.createElement("img");
    elsewhere.src = srcUrl;
    document.body.appendChild(elsewhere);

    expect(resolveGrabTarget(live, srcUrl, document)).toBe(live);
    expect(elsewhere.isConnected).toBe(true);
    elsewhere.remove();
  });
});
