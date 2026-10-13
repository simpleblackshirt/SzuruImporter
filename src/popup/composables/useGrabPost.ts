import { ScrapeResults } from "neo-scraper";
import type { Ref } from "vue";
import { BrowserCommand, ScrapedPostDetails } from "~/models";
import { cfg, usePopupStore } from "~/stores";
import { appendPageUrlToSource } from "~/utils";

/**
 * Name the popup assigns to the post scraped by neo-scraper's fallback engine
 * (engine "fallback" + its post name "Upload as URL"). The composite doubles as
 * an identity marker: `alwaysUploadAsContent` must not switch this post to
 * uploadMode "content" because its contentUrl is a web page, not a media file.
 * Must stay in sync with neo-scraper's Fallback engine naming.
 */
export const FALLBACK_UPLOAD_AS_URL_NAME = "[fallback] Upload as URL";

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

    // Clear current posts array
    pop.posts.splice(0);

    for (const result of scrapeResults.results) {
      for (const i in result.posts) {
        const vm = new ScrapedPostDetails(result.posts[i]);
        const name = result.posts[i].name ?? `Post ${parseInt(i) + 1}`; // parseInt() is required!
        vm.name = `[${result.engine}] ${name}`;

        if (!cfg.value.addAllParsedTags) {
          vm.tags.splice(0);
        }

        if (cfg.value.alwaysUploadAsContent && vm.name !== FALLBACK_UPLOAD_AS_URL_NAME) {
          vm.uploadMode = "content";
        }

        // Add current pageUrl to the source if either
        // a. user has addPageUrlToSource set to true
        // b. source is empty
        // The dedup guard in appendPageUrlToSource always runs, so engine-emitted
        // source variants of the page url (other locale/host/query form) never
        // produce duplicates.
        vm.source = appendPageUrlToSource(vm.source, vm.pageUrl, cfg.value.addPageUrlToSource);

        // Initialize instanceSpecificData with an empty object.
        for (const site of cfg.value.sites) {
          vm.instanceSpecificData[site.id] = {};
        }

        // Remove ignored tags
        // The complexity for this is quite bad but all the other ways I tried were even worse
        vm.tags = vm.tags.filter((tag) =>
          cfg.value.tagIgnores.every(
            (ignoredTag) => tag.name != ignoredTag.names[0], // no getters after deserializing
          ),
        );

        pop.posts.push(vm);
      }
    }

    if (pop.posts.length > 0) {
      // Hack so that findSimilar does not trigger when we set selectedPostId, due to the watch(...).
      // This because we might change the contentUrl in fetchPostInfo, after which we'd need to call findSimilar again.
      // In which case it would be better to just call it once.
      enableAutoSearch.value = false;
      pop.selectedPostId = pop.posts[0].id;

      if (cfg.value.loadTagCounts) {
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
  }

  return { grabPost };
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
