import { NeoScraper, ScrapeResults } from "neo-scraper";
import { BrowserCommand, GrabElementResult } from "~/models";

// Firefox `browser.tabs.executeScript()` requires scripts return a primitive value
(() => {
  // The contextMenus API only reports clicked URLs, never the clicked element
  // (Chrome's OnClickData.targetElementId has no consuming API). This
  // capture-phase listener records the right-clicked element before the menu
  // opens; it is the portable baseline for element-scoped grabs.
  let lastRightClicked: Element | undefined = undefined;

  window.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target;
      lastRightClicked = target instanceof Element ? target : undefined;
    },
    true,
  );

  function grabPost(): ScrapeResults {
    const scraper = new NeoScraper();
    return scraper.scrapeDocument(document, true);
  }

  function grabPostElement(targetElementId?: number): GrabElementResult {
    const scraper = new NeoScraper();

    if (!scraper.engines.some((engine) => engine.canImport(document.location))) {
      return new GrabElementResult("unsupported-site");
    }

    // Prefer Firefox's exact element resolution (menus.getTargetElement runs
    // in the frame the click happened in, so the id always matches this
    // document) over the possibly stale stored element.
    let element: Element | undefined = lastRightClicked;
    if (targetElementId != undefined && typeof browser.menus?.getTargetElement === "function") {
      element = browser.menus.getTargetElement(targetElementId) ?? element;
    }

    if (!element?.isConnected) {
      return new GrabElementResult("no-element");
    }

    const results = scraper.scrapeElement(element);
    if (results.posts.length == 0) {
      return new GrabElementResult("no-container");
    }
    return new GrabElementResult("ok", results);
  }

  async function messageHandler(cmd: BrowserCommand): Promise<any> {
    switch (cmd.name) {
      case "grab_post":
        return grabPost();
      case "grab_post_element":
        return grabPostElement(cmd.data?.targetElementId);
    }
  }

  browser.runtime.onMessage.addListener(messageHandler);
})();
