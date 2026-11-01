import { NeoScraper, ScrapeResults } from "neo-scraper";
import { BrowserCommand, GrabElementResult } from "~/models";

// Firefox `browser.tabs.executeScript()` requires scripts return a primitive value
(() => {
  // One shared instance: the click tracker below runs on every click and
  // constructing all engines per event would be wasteful.
  const scraper = new NeoScraper();

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

  // Viewer candidate tracking: site viewers (e.g. Lofter's) open from a
  // left-click on a card image and render the enlarged artwork WITHOUT any
  // metadata linking back to the post. Remembering the card the click
  // resolved to lets a later viewer grab carry full metadata.
  const viewerCandidateTtl = 5 * 60 * 1000;
  let viewerCandidate: { element: Element; at: number } | undefined = undefined;

  window.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const card = scraper.findPostContainer(target);
      if (card) {
        viewerCandidate = { element: card, at: Date.now() };
      }
    },
    true,
  );

  function grabPost(): ScrapeResults {
    return scraper.scrapeDocument(document, true);
  }

  function grabPostElement(targetElementId?: number): GrabElementResult {
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

    // Lofter's image viewer (div.photos) renders the enlarged image without
    // any metadata linking back to the post. The left-click that OPENED the
    // viewer resolved the real post card - prefer it while fresh. Without a
    // fresh candidate the engine falls back to a content-only grab of the
    // overlay image(s).
    if (element.closest("div.photos")) {
      const candidate = viewerCandidate;
      if (
        candidate &&
        candidate.element.isConnected &&
        Date.now() - candidate.at <= viewerCandidateTtl
      ) {
        return new GrabElementResult("ok", scraper.scrapeElement(candidate.element));
      }
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
