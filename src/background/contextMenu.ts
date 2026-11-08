import type { Menus, Tabs } from "webextension-polyfill";
import type { ScrapeResults } from "neo-scraper";
import { BrowserCommand, GrabElementResult, GrabPostElementCommandData } from "~/models";
import { siteAdapters } from "~/sites";
import { rewriteMediaUrl } from "~/sites/mediaRewrites";

const MENU_TITLE = "Send to szuru";
const MEDIA_MENU_ID = "szuru-grab-media";
const PAGE_MENU_ID = "szuru-grab-page";
const MENU_IDS: ReadonlySet<string> = new Set([MEDIA_MENU_ID, PAGE_MENU_ID]);
const STASH_KEY = "contextGrabStash";

/**
 * Android has no context menus - the API namespace itself is absent there,
 * while the permission guarantees it on desktop. Every touch must be gated on
 * this: a top-level throw would abort the whole background page before the
 * runtime.onMessage listener in main.ts is ever registered, which surfaces to
 * users as "Could not establish connection. Receiving end does not exist."
 * for every popup command (uploads included).
 */
const contextMenusSupported = typeof browser.contextMenus !== "undefined";

/**
 * Two items whose visibility is provably disjoint, so exactly one row can
 * ever show per click - checked against both engines' matchers (Chromium's
 * ExtensionContextAndPatternMatch, Firefox's menus enabledForContext +
 * getMenuContexts):
 * - "page" only applies to clicks with no link/selection/editable/media
 *   target, so the media and page items can never match the same click.
 * - "link" lives INSIDE the media item rather than in a separate one: a
 *   linked image (every booru thumbnail) reports {image, link} at once, so a
 *   separate link-context item would duplicate the row whenever the media
 *   item is also visible. Folded in, the menu shows on every link of every
 *   site - on supported sites the element grab still resolves the post
 *   container, elsewhere links usually dead-end in the failure banner
 *   (accepted cost).
 * - Deliberately NO targetUrlPatterns: Firefox hides pattern-bearing items on
 *   page-context clicks (there is no target URL to match) and matches linked
 *   images via srcUrl OR href, while Chromium checks href only for links and
 *   never consults the patterns for page - the same item definition would
 *   behave differently per engine.
 */

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
 * documentUrlPatterns of the page item, restricting it to hosts scraped by
 * our engines, so the item only exists on pages some engine could handle.
 * `*://*.host/*` also matches the bare host per match-pattern semantics; both
 * forms are emitted for parity with the site adapter host lists. Raw CDN
 * media (e.g. a pbs.twimg.com url opened in its own tab) needs no entry here:
 * the media item's image/video context covers it without host restrictions.
 */
function documentUrlPatterns(): string[] {
  const patterns = new Set<string>();
  for (const host of siteAdapters.flatMap((adapter) => adapter.hosts)) {
    patterns.add(`*://${host}/*`);
    patterns.add(`*://*.${host}/*`);
  }
  return [...patterns];
}

/** (Re)creates the menu items; idempotent across reloads and SW wakes. */
async function registerContextMenu() {
  if (!contextMenusSupported) {
    return;
  }
  await browser.contextMenus.removeAll();
  if (!(await openPopupSupported())) {
    return;
  }
  // Every image/video/link on every site: on supported sites the element grab
  // resolves the post container (links included - a tag or timestamp link
  // grabs its post); on unsupported sites and raw CDN media tabs the click
  // falls through to the tier-1 rewrite tier instead.
  browser.contextMenus.create({
    id: MEDIA_MENU_ID,
    title: MENU_TITLE,
    contexts: ["image", "video", "link"],
  });
  browser.contextMenus.create({
    id: PAGE_MENU_ID,
    title: MENU_TITLE,
    // The user's model is right-clicking the post container (e.g. a tweet's
    // text area), not only its media - that surface is the page context.
    contexts: ["page"],
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
  if (typeof info.menuItemId != "string" || !MENU_IDS.has(info.menuItemId) || !tab?.id) {
    return;
  }

  const grabbed = await grabElement(info, tab.id);

  // Count via results: scrapeResults crossed the message boundary as plain
  // JSON, so the ScrapeResults.posts getter does not exist here.
  const scrapeResults: ScrapeResults | undefined = grabbed.status == "ok" ? grabbed.scrapeResults : undefined;
  const postCount = (scrapeResults?.results ?? []).reduce((sum, result) => sum + (result.posts?.length ?? 0), 0);

  if (postCount == 0) {
    // Tier-1 rewrites: raw CDN media URLs (element grab found nothing - e.g.
    // the image was opened in its own tab). Matching produces ONE post, stashed
    // as a regular success.
    const rewritten = rewriteMediaUrl(info.srcUrl ?? info.linkUrl, info.pageUrl ?? "");
    if (rewritten) {
      await stashGrab({ targetUrl: info.srcUrl ?? info.linkUrl ?? info.pageUrl ?? "", scrapeResults: rewritten });
      await openPopupForGrab();
      return;
    }

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
if (contextMenusSupported) {
  browser.contextMenus.onClicked.addListener((info, tab) =>
    dispatchGrab(info, tab).catch((ex) => console.error("context menu grab failed:", ex)),
  );
}
