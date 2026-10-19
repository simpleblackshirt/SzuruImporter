import type { Menus, Tabs } from "webextension-polyfill";
import type { ScrapeResults } from "neo-scraper";
import { BrowserCommand, GrabElementResult, GrabPostElementCommandData } from "~/models";
import { siteAdapters } from "~/sites";

const MENU_ID = "szuru-grab-element";
const STASH_KEY = "contextGrabStash";

/**
 * storage.local contract shared with the popup (useGrabPost.pickupStashedGrab):
 * success: { grabbedAt, targetUrl, scrapeResults: <plain JSON ScrapeResults> },
 * failure: { grabbedAt, targetUrl, error }.
 * Single slot - a new grab overwrites an unpicked one, the popup removes the
 * key after consuming it. Failures are surfaced INSIDE the popup (no
 * notifications by design), so a failed grab auto-opens the popup too.
 */

/**
 * Whether the popup can be auto-opened after a grab. The context menu only
 * exists where this holds: without auto-open there is no way to surface a
 * grab (notifications are not used), so the feature stays absent entirely.
 */
async function openPopupSupported(): Promise<boolean> {
  // Chromium: the manifest floor (127) is where action.openPopup became stable.
  if (typeof browser.runtime.getBrowserInfo !== "function") {
    return true;
  }
  // Firefox: openPopup exists before 149 but only works from 149 on.
  const info = await browser.runtime.getBrowserInfo();
  const major = parseInt(info.version.split(".")[0], 10);
  return major >= 149;
}

/**
 * documentUrlPatterns restricting the menu to hosts scraped by our engines, so
 * the item only exists on pages some engine could handle. `*://*.host/*` also
 * matches the bare host per match-pattern semantics; both forms are emitted
 * for parity with the site adapter host lists.
 */
function documentUrlPatterns(): string[] {
  const patterns = new Set<string>();
  for (const adapter of siteAdapters) {
    for (const host of adapter.hosts) {
      patterns.add(`*://${host}/*`);
      patterns.add(`*://*.${host}/*`);
    }
  }
  return [...patterns];
}

/** (Re)creates the menu item; idempotent across reloads and SW wakes. */
async function registerContextMenu() {
  await browser.contextMenus.removeAll();
  if (!(await openPopupSupported())) {
    return;
  }
  browser.contextMenus.create({
    id: MENU_ID,
    title: "Send to szuru",
    // "page" matters: the user's model is right-clicking the post container
    // (e.g. a tweet's text area), not only its images or links.
    contexts: ["image", "video", "link", "page"],
    documentUrlPatterns: documentUrlPatterns(),
  });
}

/**
 * Element grab (primary path): forwards the click into the page's content
 * script. Firefox resolves the exact element from targetElementId; everywhere
 * else the content script's stored contextmenu target is used.
 */
async function grabElement(info: Menus.OnClickData, tabId: number): Promise<GrabElementResult> {
  const data = info.targetElementId != undefined ? new GrabPostElementCommandData(info.targetElementId) : undefined;
  const options = info.frameId != undefined ? { frameId: info.frameId } : undefined;
  try {
    const response = await browser.tabs.sendMessage(tabId, new BrowserCommand("grab_post_element", data), options);
    return Object.assign(new GrabElementResult("no-element"), response);
  } catch (ex) {
    // e.g. "Receiving end does not exist" for cross-origin iframes without a
    // content script.
    console.error("grab_post_element failed:", ex);
    return new GrabElementResult("no-element");
  }
}

async function stashGrab(value: Record<string, unknown>) {
  await browser.storage.local.set({
    [STASH_KEY]: { grabbedAt: Date.now(), ...value },
  });
}

async function openPopupForGrab() {
  try {
    // Supported browsers only (menu is gated on this) - a rejection here is
    // still swallowed so a gesture hiccup cannot produce an unhandled error.
    await browser.action.openPopup();
  } catch (ex) {
    console.log("action.openPopup failed:", ex);
  }
}

async function dispatchGrab(info: Menus.OnClickData, tab?: Tabs.Tab) {
  if (info.menuItemId != MENU_ID || !tab?.id) {
    return;
  }

  const grabbed = await grabElement(info, tab.id);

  // Count via results: scrapeResults crossed the message boundary as plain
  // JSON, so the ScrapeResults.posts getter does not exist here.
  const scrapeResults: ScrapeResults | undefined = grabbed.status == "ok" ? grabbed.scrapeResults : undefined;
  const postCount = (scrapeResults?.results ?? []).reduce((sum, result) => sum + (result.posts?.length ?? 0), 0);

  if (postCount == 0) {
    // Open the popup and let it claim the failure via the banner.
    await stashGrab({ targetUrl: info.pageUrl ?? "", error: "No post found under the right-clicked element." });
    await openPopupForGrab();
    return;
  }

  await stashGrab({ targetUrl: info.pageUrl ?? "", scrapeResults });
  await openPopupForGrab();
}

function onInstalledOrStartup() {
  registerContextMenu().catch((ex) => console.error("context menu registration failed:", ex));
}

browser.runtime.onInstalled.addListener(onInstalledOrStartup);
browser.runtime.onStartup.addListener(onInstalledOrStartup);
browser.contextMenus.onClicked.addListener((info, tab) =>
  dispatchGrab(info, tab).catch((ex) => console.error("context menu grab failed:", ex)),
);
