import type { Menus, Tabs } from "webextension-polyfill";
import type { ScrapeResults } from "neo-scraper";
import { BrowserCommand, GrabElementResult, GrabPostElementCommandData } from "~/models";
import { siteAdapters } from "~/sites";

const MENU_ID = "szuru-grab-element";
const STASH_KEY = "contextGrabStash";

/**
 * storage key + pickup contract shared with the popup (useGrabPost.pickupStashedGrab):
 * { grabbedAt: number, targetUrl: string, scrapeResults: <plain JSON ScrapeResults> },
 * single slot - a new grab overwrites an unpicked one, the popup removes the key
 * after materializing it.
 */

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

function notify(title: string, message: string) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("assets/icon-128.png"),
    title,
    message,
  });
}

/**
 * There is deliberately no whole-document fallback here: scraping the entire
 * visible page (a whole timeline) into the stash on a stray click would be
 * wrong. Whole-page grabbing remains the popup's job.
 */
async function dispatchGrab(info: Menus.OnClickData, tab?: Tabs.Tab) {
  if (info.menuItemId != MENU_ID || !tab?.id) {
    return;
  }

  const grabbed = await grabElement(info, tab.id);

  // Tier-1 media-URL rewrites (srcUrl/linkUrl) land between these two steps.
  // Count via results: scrapeResults crossed the message boundary as plain
  // JSON, so the ScrapeResults.posts getter does not exist here.
  const scrapeResults: ScrapeResults | undefined = grabbed.status == "ok" ? grabbed.scrapeResults : undefined;
  const postCount = (scrapeResults?.results ?? []).reduce((sum, result) => sum + (result.posts?.length ?? 0), 0);

  if (postCount == 0) {
    notify("Grab failed", "Right-click inside a post to grab it for szuru.");
    return;
  }

  await browser.storage.local.set({
    [STASH_KEY]: {
      grabbedAt: Date.now(),
      targetUrl: info.pageUrl ?? "",
      // The result crossed a message boundary, so this is plain JSON - exactly
      // the shape the popup's pickup reconstructs via Object.assign.
      scrapeResults,
    },
  });

  notify("Grabbed for szuru", `${postCount} post(s) grabbed - open the popup to review.`);

  try {
    // Chromium >= 127, Firefox >= 149. Older Firefox has no openPopup (or
    // rejects without a usable gesture) - the notification already tells the
    // user to open the popup, which picks the stash up on open.
    await browser.action.openPopup();
  } catch (ex) {
    console.log("action.openPopup unavailable, open the popup manually:", ex);
  }
}

function onInstalledOrStartup() {
  registerContextMenu().catch((ex) => console.error("context menu registration failed:", ex));
}

browser.runtime.onInstalled.addListener(onInstalledOrStartup);
browser.runtime.onStartup.addListener(onInstalledOrStartup);
browser.contextMenus.onClicked.addListener((info, tab) =>
  dispatchGrab(info, tab).catch((ex) => console.error("context menu grab failed:", ex)),
);
