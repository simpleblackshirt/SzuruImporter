import type { WebRequest } from "webextension-polyfill";
import { hasWebRequestBlocking, refererExtraInfoSpec } from "./referer";

/** The slice of ScrapedPostDetails the referrer listener needs (see usePopupStore.getPostForContentUrl). */
export interface PopupReferrerSource {
  contentUrl: string;
  referrer?: string;
}

/**
 * Add "Referer" header to requests if post.referrer is set - the popup <img>
 * display path for hotlink-protected media. This is the FIREFOX path:
 * Firefox MV3 keeps blocking webRequest (mv3-facts W1) and the gecko manifest
 * variant ships webRequestBlocking, so the runtime gate below auto-revives it.
 * On Chromium the DNR session rules (~/webRequest/dnrReferer) cover popup
 * requests not originating from a tab (TAB_ID_NONE) - the caveat for popups
 * opened as real tabs is documented in
 * docs/plan/20261015-mv3-migration/t3-mv3-background-runtime.md.
 */
export function registerPopupReferrerListener(
  getPostForContentUrl: (url: string) => PopupReferrerSource | undefined,
): void {
  // Chromium manifest variant: the permission is pruned, registering a
  // "blocking" listener would throw in the popup page. DNR covers this path.
  // Also gate the namespace itself: it can be absent where the platform drops
  // the API entirely (the same startup-crash trap as the background page),
  // and a throw here must not take the popup down.
  if (!hasWebRequestBlocking() || typeof browser.webRequest === "undefined") {
    return;
  }

  browser.webRequest.onBeforeSendHeaders.addListener(
    (details: WebRequest.OnBeforeSendHeadersDetailsType): WebRequest.BlockingResponse => {
      const requestHeaders = details.requestHeaders ?? [];

      // Find which ScrapedPost this belongs to, if any.
      const post = getPostForContentUrl(details.url);
      if (post != undefined && post.referrer) {
        console.log(`Setting referrer to '${post.referrer}' for request to '${post.contentUrl}'.`);
        // TODO: If the headers already have a 'Referer' header this will _not_ override that.
        // As far as I am aware the 'img' tag doesn't set this header, so it shouldn't be a problem.
        requestHeaders.push({ name: "Referer", value: post.referrer });
      }

      return {
        requestHeaders,
      };
    },
    { urls: ["<all_urls>"] },
    refererExtraInfoSpec(),
  );
}
