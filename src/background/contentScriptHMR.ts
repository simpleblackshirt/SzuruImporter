import { isForbiddenUrl } from "~/env";

// Firefox fetch files from cache instead of reloading changes from disk,
// hmr will not work as Chromium based browser
browser.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  // Filter out non main window events.
  if (frameId !== 0) return;

  if (isForbiddenUrl(url)) return;

  // inject the latest scripts; mv3-facts W1: tabs.executeScript is MV2-only on both
  // browsers, browser.scripting.executeScript targets web pages only (never
  // moz-extension:// - Firefox 149+ rejects those outright).
  browser.scripting
    .executeScript({
      target: { tabId },
      files: ["dist/contentScripts/index.global.js"],
    })
    .catch((error) => console.error(error));
});
