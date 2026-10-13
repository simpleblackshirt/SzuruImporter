import type { WebRequest } from "webextension-polyfill";
import { isChrome } from "~/env";

/**
 * Firefox reports originUrl (full url), chromium reports initiator (bare origin).
 * Returns whether the request was initiated by one of our own extension pages.
 */
export function isExtensionInitiated(
  details: Pick<WebRequest.OnBeforeSendHeadersDetailsType, "originUrl" | "initiator">,
): boolean {
  const extensionOrigin = browser.runtime.getURL("").replace(/\/+$/, "");
  return details.originUrl?.startsWith(extensionOrigin) || details.initiator?.startsWith(extensionOrigin);
}

/**
 * Chromium only exposes headers like Referer to onBeforeSendHeaders listeners
 * that opt into the "extraHeaders" spec.
 */
export function refererExtraInfoSpec(
  base: WebRequest.OnBeforeSendHeadersOptions[] = ["requestHeaders", "blocking"],
): WebRequest.OnBeforeSendHeadersOptions[] {
  if (!isChrome) {
    return base;
  }
  return [...base, "extraHeaders"];
}
