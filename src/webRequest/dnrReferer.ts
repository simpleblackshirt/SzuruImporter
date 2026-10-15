import type { DeclarativeNetRequest } from "webextension-polyfill";
import { refererRules, type RefererRule } from "~/sites";

/**
 * Chromium MV3 referer mechanism (mv3-facts W1): blocking webRequest is gone,
 * so session DNR rules set the hotlink-protected CDNs' Referer. DNR applies to
 * the extension's own service-worker fetches (and popup requests not belonging
 * to a tab); `tabIds: [TAB_ID_NONE]` matches requests NOT originating from a
 * web-page tab - the `extensionInitiatedOnly` equivalent, so normal browsing
 * traffic is never modified. Firefox keeps blocking webRequest instead (the
 * gecko manifest ships webRequestBlocking); see ~/webRequest/referer.ts.
 */

// Reserved session-rule id range: one id per referer registry entry. Removing
// exactly these ids before re-adding keeps every registration idempotent.
const RULE_ID_BASE = 1;

export function buildDnrRefererRules(): DeclarativeNetRequest.Rule[] {
  return refererRules.map((rule: RefererRule, index): DeclarativeNetRequest.Rule => {
    if (!rule.extensionInitiatedOnly) {
      // The DNR shape can only express "not from any tab"; an unrestricted
      // rule would rewrite web-page traffic and must never be added silently.
      throw new Error(`No DNR translation for referer rule of '${rule.urlFilter.join(", ")}'.`);
    }
    return {
      id: RULE_ID_BASE + index,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: rule.referer }],
      },
      condition: {
        tabIds: [browser.tabs.TAB_ID_NONE],
        requestDomains: rule.requestDomains,
        // fetch (API resolvers, blob downloads, HEAD probes) + <img> display +
        // anything else the extension itself requests (mv3-facts W1 design).
        resourceTypes: ["xmlhttprequest", "image", "other"],
      },
    };
  });
}

export async function registerDnrRefererRules(): Promise<void> {
  await browser.declarativeNetRequest.updateSessionRules({
    // Session rules survive SW restarts but are cleared at browser shutdown
    // and extension update (mv3-facts W1); removeRuleIds ignores missing ids,
    // so re-registration on every wake converges to exactly one rule per entry.
    removeRuleIds: refererRules.map((_, index) => RULE_ID_BASE + index),
    addRules: buildDnrRefererRules(),
  });
}
