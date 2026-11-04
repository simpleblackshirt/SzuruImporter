import { encodeTagName, getErrorMessage, getUrl } from "~/utils";
import { refererRules } from "~/sites";
import {
  BrowserCommand,
  PostUploadCommandData,
  PostUploadInfo,
  SetPostUploadInfoData,
  SetExactPostId,
  PostUpdateCommandData,
  FetchCommandData,
} from "~/models";
import { MicroTag, PostAlreadyUploadedError, UpdatePoolRequest } from "~/api/models";
import SzurubooruApi from "~/api";
import { candidateTagNames, computeTagUpdates } from "./tagFixup";
import type { ScrapedTagInfo } from "./tagFixup";
import { registerDnrRefererRules } from "~/webRequest/dnrReferer";
import { hasWebRequestBlocking, isExtensionInitiated, refererExtraInfoSpec } from "~/webRequest/referer";
import "./contextMenu";

// Dev-only: an MV3 background is a built classic script / service worker and cannot load
// the vite dev client (same-origin rule), so there is no HMR socket here - `pnpm dev:js`
// rebuilds this bundle and the extension is reloaded from outside (see README "Development
// & hot reload"). What remains is the dev-only injection of the latest content script.
if (__DEV__) {
  import("./contentScriptHMR");
}

browser.notifications.onClicked.addListener((url) => {
  // Only upload-result notifications carry http(s) url ids; anything else is ignored.
  if (url && /^https?:\/\//.test(url)) {
    browser.tabs.create({ url });
    browser.notifications.clear(url);
  }
});

/**
 * Syncs scraped tag data onto the szuru tags of a post: scraped categories are
 * applied to tags still in the instance's default category, and artist profile
 * urls are merged into the tag descriptions. Returns how many tags actually
 * changed (tags that already match are not PUT at all).
 */
async function applyTagFixup(szuru: SzurubooruApi, scrapedTags: ScrapedTagInfo[], postTags: MicroTag[]): Promise<number> {
  const candidateNames = candidateTagNames(scrapedTags, postTags);
  if (candidateNames.length == 0) {
    return 0;
  }

  const tags = (await szuru.getTags(candidateNames.map(encodeTagName).join())).results;
  const categories = (await szuru.getTagCategories()).results;
  const updates = computeTagUpdates(tags, scrapedTags, categories);

  for (const update of updates) {
    await szuru.updateTag(update.name, {
      version: update.version,
      category: update.category,
      description: update.description,
    });
  }

  return updates.length;
}

async function uploadPost(data: PostUploadCommandData) {
  const info: PostUploadInfo = {
    state: "uploading",
  };

  const pushInfo = () =>
    browser.runtime.sendMessage(
      new BrowserCommand("set_post_upload_info", new SetPostUploadInfoData(data.selectedSite.id, data.post.id, info)),
    );

  try {
    const szuru = SzurubooruApi.createFromConfig(data.selectedSite);

    // Create and upload post
    pushInfo();

    const contentToken = data.post.instanceSpecificData[data.selectedSite.id]?.contentToken;

    if (!contentToken) {
      // TODO: If the scraped page url is the source then we need to do the uploadTempFileFromContent here!
      console.log("contentToken is undefined. This could be a problem for some sources!");
    }

    const createdPost = await szuru.createPost(data.post, contentToken);

    info.state = "uploaded";
    info.instancePostId = createdPost.id;
    pushInfo();

    // Sync scraped tag categories and artist profile urls onto the szuru tags.
    // New tags are created by szurubooru in its DEFAULT category (whatever the
    // instance named it), so the categories need fixing afterwards.
    const changedTags = await applyTagFixup(szuru, data.post.tags, createdPost.tags);
    if (changedTags > 0) {
      info.updateTagsState = { totalChanged: changedTags };
      pushInfo();
    }

    // TODO: This code shouldn't all be in the same try catch.
    // Add post to pools
    for (const scrapedPool of data.post.pools) {
      // Attention! Don't use the .name getter as it does not exist. Just use names[0].
      const existingPools = await szuru.getPools(encodeTagName(scrapedPool.names[0]), 0, 1, ["id", "posts", "version"]);

      if (existingPools.results.length == 0) {
        // Pool does not exist. Create a new pool and add the post to it in one API call.
        console.log(`Creating new pool ${scrapedPool.names[0]} and adding post ${createdPost.id}.`);
        await szuru.createPool(scrapedPool.names[0], "default", [createdPost.id]);
      } else {
        // Pool exists, so add it to the existing pool.
        const existingPool = existingPools.results[0];
        const posts = existingPool.posts.map((x) => x.id);
        posts.push(createdPost.id);

        console.log(`Adding post ${createdPost.id} to existing pool ${existingPool.id}`);

        const updateRequest = <UpdatePoolRequest>{
          version: existingPool.version,
          posts,
        };

        await szuru.updatePool(existingPool.id, updateRequest);
      }
    }

    if (data.sendNotifications && browser.notifications) {
      const createdPostUrl = getUrl(data.selectedSite.domain, "post", createdPost.id.toString());
      browser.notifications.create(createdPostUrl, {
        type: "basic",
        iconUrl: browser.runtime.getURL("assets/icon-128.png"),
        title: data.selectedSite.domain,
        message: `Uploaded ${data.post.contentUrl}`,
      });
    }
  } catch (ex: any) {
    console.error(ex);
    if (ex.name && ex.name == "PostAlreadyUploadedError") {
      const otherPostId = (ex as PostAlreadyUploadedError).otherPostId;
      browser.runtime.sendMessage(
        new BrowserCommand("set_exact_post_id", new SetExactPostId(data.selectedSite.id, data.post.id, otherPostId)),
      );
      // We don't set an error message, because we have a different message for posts that are already uploaded.
    } else {
      // Set generic error message.
      info.error = getErrorMessage(ex);
    }
    info.state = "error";
    pushInfo();
  }
}

async function updatePost(data: PostUpdateCommandData) {
  const info: PostUploadInfo = {
    state: "uploading",
    instancePostId: data.postId,
  };

  const pushInfo = () =>
    browser.runtime.sendMessage(
      new BrowserCommand(
        "set_post_update_info",
        new SetPostUploadInfoData(data.selectedSite.id, `merge-${data.postId}`, info),
      ),
    );

  try {
    const szuru = SzurubooruApi.createFromConfig(data.selectedSite);

    pushInfo();

    const updatedPost = await szuru.updatePost(data.postId, data.updateRequest);

    // The merge may have added tags to the post - sync scraped categories and
    // profile urls onto them, same as the upload flow does. The merge UI has
    // no per-tag state display, so nothing is reported here.
    await applyTagFixup(szuru, data.scrapedTags, updatedPost.tags);

    info.state = "uploaded";
    pushInfo();
  } catch (ex: any) {
    console.error(ex);
    info.state = "error";
    info.error = getErrorMessage(ex);
    pushInfo();
  }
}

/**
 * Executes fetch in the background page. This allows us to do "forbidden" stuff, like ignoring CORS headers.
 * @param data
 * @returns
 */
async function executeFetch(data: FetchCommandData) {
  return await fetch(data.url, data.options);
}

async function messageHandler(cmd: BrowserCommand): Promise<any> {
  console.log("Background received message:");
  console.dir(cmd);

  switch (cmd.name) {
    case "upload_post":
      return uploadPost(cmd.data);
    case "update_post":
      return updatePost(cmd.data);
    case "fetch":
      return executeFetch(cmd.data);
  }
}

browser.runtime.onMessage.addListener(messageHandler);

// Hotlink-protected media CDNs (see ~/sites): attach the site's Referer only
// for extension-initiated requests - never for requests from normal web browsing.
// Firefox MV3 keeps blocking webRequest (mv3-facts W1): the gecko manifest
// variant ships webRequestBlocking and this runtime gate auto-revives the
// listener there. Chromium (permission pruned) uses DNR session rules instead.
if (hasWebRequestBlocking()) {
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const rule = refererRules.find(
        (x) => (!x.extensionInitiatedOnly || isExtensionInitiated(details)) && x.urlPattern.test(details.url),
      );

      if (!rule) {
        return {};
      }

      // Replace any existing Referer to make the outgoing header deterministic.
      const requestHeaders = (details.requestHeaders ?? []).filter(
        (header) => header.name.toLowerCase() != "referer",
      );
      requestHeaders.push({ name: "Referer", value: rule.referer });

      return { requestHeaders };
    },
    { urls: refererRules.flatMap((x) => x.urlFilter) },
    refererExtraInfoSpec(["blocking", "requestHeaders"]),
  );
} else {
  // Session rules survive SW restarts but are cleared at browser shutdown and
  // extension update (mv3-facts W1) - re-register idempotently on every wake.
  registerDnrRefererRules().catch((ex) => console.error("registerDnrRefererRules failed:", ex));
}
