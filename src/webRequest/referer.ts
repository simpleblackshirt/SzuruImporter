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

/**
 * Firefox MV3 keeps blocking webRequest (mv3-facts W1), Chromium does not: this
 * gate reads the runtime manifest, so the gecko variant (permissions include
 * webRequestBlocking) auto-revives the blocking-webRequest referer listeners in
 * main.ts and popupReferrer.ts, while the Chromium variant takes the DNR
 * session-rule path (~/webRequest/dnrReferer).
 */
export function hasWebRequestBlocking(): boolean {
  return browser.runtime.getManifest().permissions?.includes("webRequestBlocking") ?? false;
}
