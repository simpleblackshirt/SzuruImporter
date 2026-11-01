import { ScrapeResults } from "neo-scraper";
import type { Ref } from "vue";
import { BrowserCommand, ScrapedPostDetails } from "~/models";
import { cfg, usePopupStore } from "~/stores";
import { materializeScrapeResults } from "./materialize";

export { FALLBACK_UPLOAD_AS_URL_NAME } from "./materialize";

/**
 * storage.local key + value contract shared with the background (contextMenu.ts):
 * success: { grabbedAt, targetUrl, scrapeResults: <plain JSON ScrapeResults> },
 * failure: { grabbedAt, targetUrl, error: string }.
 * Single slot - a new grab overwrites an unpicked one, the popup removes the
 * key after consuming it.
 */
const STASH_KEY = "contextGrabStash";
/** Unpicked grabs older than this are discarded at pickup. */
const STASH_TTL_MS = 5 * 60 * 1000;

interface GrabPostDeps {
  /**
   * Shared with the page watches: grabPost turns it off while replacing the
   * posts so the selectedPostId watch does not trigger findSimilar mid-grab.
   */
  enableAutoSearch: Ref<boolean>;
  findSimilar: (post: ScrapedPostDetails | undefined) => Promise<void>;
  loadTagCounts: () => Promise<void>;
  fetchPostsInfo: () => Promise<void>;
}

/** Orchestrates multi-tab grabbing: scrape the selected tabs and rebuild the popup's posts. */
export function useGrabPost(deps: GrabPostDeps) {
  const pop = usePopupStore();
  const { enableAutoSearch, findSimilar, loadTagCounts, fetchPostsInfo } = deps;

  /**
   * The post-population block shared by both entry points (tab grab and stash
   * pickup): select the first post and kick off the content info/similar search
   * pipeline exactly once.
   */
  async function populatePosts() {
    // Hack so that findSimilar does not trigger when we set selectedPostId, due to the watch(...).
    // This because we might change the contentUrl in fetchPostInfo, after which we'd need to call findSimilar again.
    // In which case it would be better to just call it once.
    enableAutoSearch.value = false;
    pop.selectedPostId = pop.posts[0].id;

    // Resolution needs the same instance tag data as the usage counts, so
    // either option triggers the shared (single) batched fetch.
    if (cfg.value.loadTagCounts || cfg.value.resolveTagAliases) {
      loadTagCounts();
    }

    if (cfg.value.fetchPostInfo) {
      await fetchPostsInfo();
    }

    // Delayed call to findSimilar, as fetchPostInfo might change the post's contentUrl.
    enableAutoSearch.value = true;
    if (cfg.value.autoSearchSimilar) {
      findSimilar(pop.selectedPost);
    }
  }

  async function grabPost() {
    // Get active tab
    const selectedTabIds = await getSelectedTabIds();

    const scrapeResults: ScrapeResults = new ScrapeResults();
    for (const selectedTabId of selectedTabIds) {
      // Send 'grab_post' to the content script on the active tabs
      const x = await browser.tabs.sendMessage(selectedTabId, new BrowserCommand("grab_post"));
      // We need to create a new ScrapeResults object and fill it with our data, because the get_posts()
      // method gets 'lost' when sent from the contentscript to the popup (it gets JSON.stringified and any prototype defines are lost there)
      const results: ScrapeResults = Object.assign(new ScrapeResults(), x);

      for (const result of results.results) {
        const res = scrapeResults.results.find((r) => r.engine === result.engine);
        if (res) res.posts.push(...result.posts);
        else scrapeResults.results.push(result);
      }
    }

    console.dir(scrapeResults);

    pop.posts.splice(0);
    pop.posts.push(...materializeScrapeResults(scrapeResults));

    if (pop.posts.length > 0) {
      await populatePosts();
    }
  }

  /**
   * Picks up a context-menu stash written by the background. Returns:
   * - "picked": posts materialized into the popup,
   * - "failed": the grab failed; the error banner is shown instead (the tab
   *   auto-grab must NOT run - the user aimed at a post, not at the page),
   * - "none": nothing usable, caller falls through to the tab grab.
   * The stash key is removed once consumed, so a popup crash never loses a grab.
   */
  async function pickupStashedGrab(): Promise<"picked" | "failed" | "none"> {
    let stored: any;
    try {
      stored = (await browser.storage.local.get(STASH_KEY))[STASH_KEY];
    } catch (ex) {
      console.error("Reading the context grab stash failed:", ex);
      return "none";
    }

    if (!stored) {
      return "none";
    }

    if (typeof stored.grabbedAt != "number" || Date.now() - stored.grabbedAt > STASH_TTL_MS) {
      await browser.storage.local.remove(STASH_KEY);
      return "none";
    }

    // Failure record: the background opened the popup to show exactly this.
    if (stored.error) {
      pop.contextGrabError = stored.error;
      await browser.storage.local.remove(STASH_KEY);
      return "failed";
    }

    if (!stored.scrapeResults) {
      await browser.storage.local.remove(STASH_KEY);
      return "none";
    }

    try {
      // Same prototype rehydration as the tab grab path: storage JSON-serializes
      // the class instances away.
      const scrapeResults = Object.assign(new ScrapeResults(), stored.scrapeResults);
      // Materialize before touching the store: a deterministically bad stash
      // must never block popup opens.
      const posts = materializeScrapeResults(scrapeResults);
      pop.posts.splice(0);
      pop.posts.push(...posts);
    } catch (ex) {
      console.error("Materializing the stashed grab failed:", ex);
      await browser.storage.local.remove(STASH_KEY);
      return "none";
    }

    await browser.storage.local.remove(STASH_KEY);

    if (pop.posts.length > 0) {
      await populatePosts();
    }

    return "picked";
  }

  return { grabPost, pickupStashedGrab };
}

async function getSelectedTabIds(): Promise<number[]> {
  const selectedTabs = await browser.tabs.query({
    highlighted: true,
    currentWindow: true,
  });

  if (selectedTabs.length > 0 && selectedTabs[0].id) {
    return selectedTabs.filter((tab) => tab.id).map((tab) => tab.id as number);
  }
  throw new Error("No active tab.");
}
