import type { WebRequest } from "webextension-polyfill";
import { refererExtraInfoSpec } from "./referer";

/** The slice of ScrapedPostDetails the referrer listener needs (see usePopupStore.getPostForContentUrl). */
export interface PopupReferrerSource {
  contentUrl: string;
  referrer?: string;
}

/**
 * Add "Referer" header to all requests if post.referrer is set.
 * This is needed in some rare cases where websites disallow hotlinking to images.
 * This will probably stop working in Chrome sometime in 2023 due to the Manifest V3 webRequestBlocking bullshit.
 * Firefox users should be fine.
 */
export function registerPopupReferrerListener(
  getPostForContentUrl: (url: string) => PopupReferrerSource | undefined,
): void {
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
