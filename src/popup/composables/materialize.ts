import { ScrapeResults } from "neo-scraper";
import { ScrapedPostDetails } from "~/models";
import { cfg } from "~/stores";
import { appendPageUrlToSource } from "~/utils";

/**
 * Name the popup assigns to the post scraped by neo-scraper's fallback engine
 * (engine "fallback" + its post name "Upload as URL"). The composite doubles as
 * an identity marker: `alwaysUploadAsContent` must not switch this post to
 * uploadMode "content" because its contentUrl is a web page, not a media file.
 * Must stay in sync with neo-scraper's Fallback engine naming.
 */
export const FALLBACK_UPLOAD_AS_URL_NAME = "[fallback] Upload as URL";

/**
 * Converts ScrapeResults into the popup's post view models. Pure: populating
 * the store is the caller's job. Shared by the tab grab (useGrabPost) and the
 * context-menu stash pickup so both land in the same review UX.
 */
export function materializeScrapeResults(scrapeResults: ScrapeResults): ScrapedPostDetails[] {
  const posts: ScrapedPostDetails[] = [];

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

      posts.push(vm);
    }
  }

  return posts;
}
