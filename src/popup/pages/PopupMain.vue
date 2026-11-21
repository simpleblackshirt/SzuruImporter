<script setup lang="ts">
import { useDark } from "@vueuse/core";
import { getUrl, getPostInfoSummary } from "~/utils";
import { TagDetails, PoolDetails, ScrapedPostDetails } from "~/models";
import { isMobile } from "~/env";
import { cfg, usePopupStore } from "~/stores";
import SzurubooruApi from "~/api";
import { useRouter } from "vue-router";
import { getSimilarPosts } from "../composables/similarPosts";
import { useSimilarSearch } from "../composables/useSimilarSearch";
import { useTagCounts } from "../composables/useTagCounts";
import { useContentInfo } from "../composables/useContentInfo";
import { useGrabPost } from "../composables/useGrabPost";
import { useUpload, type UploadAttempt } from "../composables/useUpload";
import { useKeyboardShortcuts } from "../composables/useShortcuts";
import { pushTagWithImplications } from "../composables/tagImplications";
import {
  clearStagedState,
  dedupeStaged,
  stripStagedImplications,
  toStagedInfos,
  type StagedTagInfo,
} from "~/utils/staged-tags";
import { cycleSafety, encodeTagName, getCreatedTagsText, neighborPostId } from "~/utils";

const pop = usePopupStore();

const selectedSite = computed(() => {
  if (cfg.value.selectedSiteId) {
    return cfg.value.sites.find((x) => x.id == cfg.value.selectedSiteId);
  }
});

const szuru = computed(() => {
  return selectedSite.value ? SzurubooruApi.createFromConfig(selectedSite.value) : undefined;
});

const { isSearchingForSimilarPosts, enableAutoSearch, findSimilar, clickFindSimilar } = useSimilarSearch(szuru);
const { loadTagCounts } = useTagCounts(szuru);
const { fetchPostsInfo } = useContentInfo(pop.posts);
const { grabPost, pickupStashedGrab } = useGrabPost({ enableAutoSearch, findSimilar, loadTagCounts, fetchPostsInfo });
const { upload } = useUpload({ szuru, selectedSite });

// Staged (creation-card) entries of the current session, deduped by name -
// with "keep tags between posts" the same staged entry can sit on several
// posts. Drives the autocomplete merge (re-adding a staged tag to another
// post joins it with its staged state).
const stagedTagInfos = computed<StagedTagInfo[]>(() => dedupeStaged(pop.posts.flatMap((x) => toStagedInfos(x.tags))));

// Staged entries of the selected post only: a creation card may reference
// these as implication targets, because their save is the one that creates
// them. Staged entries on other posts must not satisfy validation - the save
// at hand could never materialize that edge.
const selectedStagedTagInfos = computed<StagedTagInfo[]>(() =>
  pop.selectedPost ? toStagedInfos(pop.selectedPost.tags) : [],
);

// Tags currently awaiting a creation-card decision (do not exist on the
// instance, staging enabled). One card per tag: rapid adds don't drop
// earlier cards, mirroring the spec's "creation card attached to that tag".
const pendingTags = ref<TagDetails[]>([]);

// Component refs of the open cards, by tag name - lets a second Enter press
// (empty tag input) confirm the most recent pending card without clicking it.
const cardRefs = new Map<string, { confirm: () => void }>();

function setCardRef(name: string, el: unknown) {
  if (el) {
    cardRefs.set(name, el as { confirm: () => void });
  } else {
    cardRefs.delete(name);
  }
}

// (Reactive) shorthand for `main.selectedPost.instanceSpecificData.get(config.selectedSiteId)`.
// This should only be used as if it were readonly, because the instanceId might change.
const instanceSpecificData = readonly(
  computed(() => {
    if (pop.selectedPost && cfg.value.selectedSiteId) {
      return pop.selectedPost.instanceSpecificData[cfg.value.selectedSiteId];
    }
  }),
);

const tagInput = ref<{ focus: () => void } | null>(null);

// Focus the tag input once the grabbed post has rendered, so the
// shortcut / toolbar flow is "open the popup and type tags". Only the first
// appearance of a post per popup session focuses: later post switches must
// not steal the caret mid-interaction. Skipped while the Tags section is
// collapsed - the section body is v-if'd away, so there is nothing to focus.
let tagInputFocused = false;
watch(
  () => pop.selectedPost,
  async (post) => {
    if (!post || tagInputFocused || !cfg.value.popup.expandTags) return;
    tagInputFocused = true;

    await nextTick();
    tagInput.value?.focus();
    // Firefox popups can swallow a programmatic focus fired right at open;
    // one delayed retry is cheap insurance (refocusing stays a no-op).
    window.setTimeout(() => tagInput.value?.focus(), 100);
  },
  { immediate: true },
);

watch(
  () => pop.selectedPostId,
  (value, oldValue) => {
    // Carry the previous post's tags over to the newly selected post when wanted.
    // The previous post lookup naturally fails during grabs (posts are replaced
    // before selectedPostId is set), so fresh grabs are never polluted.
    if (cfg.value.popup.keepTagsBetweenPosts) {
      const previousPost = pop.posts.find((x) => x.id == oldValue);
      const selectedPost = pop.posts.find((x) => x.id == value);
      if (previousPost && selectedPost) {
        for (const tag of previousPost.tags) {
          // No implication expansion: implications were already expanded when
          // the tag was added, the carried set mirrors the previous post.
          pushTagWithImplications(selectedPost.tags, tag, false);
        }
      }
    }

    // Call findSimilar if wanted. Video posts are excluded from the auto
    // search (see useGrabPost) - it would download the entire media on mere
    // selection for an exact-match-only check.
    if (cfg.value.autoSearchSimilar && enableAutoSearch.value) {
      const selectedPost = pop.posts.find((x) => x.id == value);
      if (selectedPost && selectedPost.contentType != "video") {
        findSimilar(selectedPost);
      }
    }
  },
);

watch(
  () => cfg.value.selectedSiteId,
  async (value, oldValue) => {
    // If changed
    if (value != oldValue) {
      // Update selectedSiteId in config
      cfg.value.selectedSiteId = value;
      // Staged choices belong to the instance they were made against:
      // switching targets clears them, so tags honestly show as unknown
      // ("new") again instead of materializing on the wrong instance.
      for (const post of pop.posts) {
        clearStagedState(post.tags);
      }
      pendingTags.value = [];
      // Call findSimilar if wanted. Video posts are excluded from the auto
      // search (see useGrabPost).
      if (cfg.value.autoSearchSimilar && pop.selectedPost && pop.selectedPost.contentType != "video") {
        findSimilar(pop.selectedPost);
      }
    }
  },
);

function openOptionsPage() {
  browser.runtime.openOptionsPage();
}

function removeTag(tag: TagDetails) {
  const wasStaged = !!tag.staged;

  if (cfg.value.popup.keepTagsBetweenPosts) {
    // Remove the tag from every post by name. Carried tags would otherwise
    // resurrect on the next switch via a post that still had the tag.
    for (const post of pop.posts) {
      const idx = post.tags.findIndex((x) => x.name == tag.name);
      if (idx != -1) {
        post.tags.splice(idx, 1);
      }
    }
  } else if (pop.selectedPost) {
    const idx = pop.selectedPost.tags.indexOf(tag);
    if (idx != -1) {
      pop.selectedPost.tags.splice(idx, 1);
    }
  }

  if (wasStaged) {
    // Removal propagates: strip the removed name from every staged tag's
    // implication list, so a save can't resurrect it via the backend's
    // auto-create of unknown implication names.
    for (const post of pop.posts) {
      stripStagedImplications(post.tags, tag.name);
    }
  }
}

function removePool(pool: PoolDetails) {
  if (pop.selectedPost) {
    const idx = pop.selectedPost.pools.indexOf(pool);
    if (idx != -1) {
      pop.selectedPost.pools.splice(idx, 1);
    }
  }
}

function getActiveSitePostUrl(postId: number): string {
  if (!selectedSite.value) return "";
  return getUrl(selectedSite.value.domain, "post", postId.toString());
}

function addTag(tag: TagDetails) {
  if (pop.selectedPost && tag.name.length > 0) {
    // The default exists-check of pushTagWithImplications covers the tag and
    // its implications against the post's tag list.
    pushTagWithImplications(pop.selectedPost.tags, tag, cfg.value.addTagImplications);
  }
}

/**
 * A tag that arrives without instance data was typed manually and might still
 * exist on the instance (loadTagCounts off, stale data, exact-name entry).
 * With staging enabled, such tags get one existence check: found - enrich and
 * add normally; not found - open the creation card.
 */
async function addTagWithStaging(tag: TagDetails) {
  if (!pop.selectedPost) return;

  // Enter on an empty input with a pending card = "press that card's
  // button": confirm() runs the card's real logic (untouched -> plain add,
  // modified -> staged; validation failure keeps the card open). Multiple
  // pending cards resolve newest-first, one press each.
  if (tag.name.length == 0) {
    const last = pendingTags.value.at(-1);
    if (last) {
      cardRefs.get(last.name)?.confirm();
    }
    return;
  }

  if (!cfg.value.stagedTagCreation || tag.staged || tag.category !== undefined || tag.usages !== undefined) {
    addTag(tag);
    return;
  }

  try {
    const res = await szuru.value?.getTags(encodeTagName(tag.name), 0, 1, [
      "names",
      "category",
      "usages",
      "implications",
    ]);
    if (res && res.results.length > 0) {
      const instanceTag = res.results.find((x) => x.names.includes(tag.name));
      if (instanceTag) {
        // Exact name match: enrich from the instance (category/usages) and
        // add like any backend-known tag.
        addTag(TagDetails.fromTag(instanceTag));
      } else {
        // Alias of an existing tag: stock behavior (the backend resolves
        // aliases at save time; staging an alias would be wrong).
        addTag(tag);
      }
      return;
    }
  } catch (ex) {
    // The check failing must not block adding: fall through to the card -
    // confirming re-validates against the instance.
    console.warn("Tag existence check failed:", ex);
  }

  // One card per name: re-typing a name that already awaits a decision
  // replaces nothing and adds nothing.
  if (!pendingTags.value.some((x) => x.name == tag.name)) {
    pendingTags.value.push(tag);
  }
}

function dismissPendingTag(tag: TagDetails) {
  const idx = pendingTags.value.indexOf(tag);
  if (idx != -1) {
    pendingTags.value.splice(idx, 1);
  }
}

function confirmStagedTag(tag: TagDetails, choice: { category: string; implications: TagDetails[] }) {
  dismissPendingTag(tag);
  if (!pop.selectedPost) return;

  // Staging only: optimistic local state, zero server writes. The tag is
  // created through the API when the post is saved.
  tag.category = choice.category;
  tag.staged = { implications: choice.implications.map((x) => x.name) };

  // The backend would apply the implications at save time anyway - adding
  // the targets as plain tags surfaces them as editable chips and puts them
  // into the payload. Each target carries its own category/staged flag; its
  // own implications expand per the global setting, like a manual add.
  tag.implications = choice.implications;
  pushTagWithImplications(pop.selectedPost.tags, tag, cfg.value.addTagImplications);
}

function skipStagedTag(tag: TagDetails) {
  dismissPendingTag(tag);
  addTag(tag);
}

function addPool(pool: PoolDetails) {
  if (pop.selectedPost) {
    // Only add pool if it doesn't already exist
    if (pool.name.length > 0 && pop.selectedPost.pools.find((x) => x.name == pool.name) == undefined) {
      pop.selectedPost.pools.push(pool);
    }
  }
}

// Cool people would use https://kazupon.github.io/vue-i18n/guide/pluralization.html
function getUpdatedTagsText(count: number) {
  return `Updated ${count} tag${count > 1 ? "s" : ""}`;
}

function onResolutionLoaded(res: any) {
  // This no longer checks for `!pop.selectedPost.resolution` because the resolution can change if the contentUrl is updated.
  if (pop.selectedPost) {
    pop.selectedPost.resolution = res;
  }
}

onMounted(async () => {
  if (pop.posts.length == 0) {
    // A context-menu grab stashed by the background takes precedence over the
    // active-tab auto-grab; "failed" shows the error banner instead, and only
    // "none" (nothing stashed) falls through to grabPost().
    const picked = await pickupStashedGrab();
    if (picked == "none") {
      grabPost();
    }
  }
});

// --- Keyboard workflow -----------------------------------------------------
// Shared shortcut wiring (Ctrl+Enter, plain keys, cheat sheet) lives in
// useKeyboardShortcuts; the page-specific actions are bound below.

const cheatsheetOpen = ref(false);

const shortcuts = [
  { keys: "Ctrl+Enter", label: "Import the selected post" },
  { keys: "Ctrl+Shift+Enter", label: "Import and advance to the next post" },
  { keys: "s · Ctrl+S", label: "Cycle safety" },
  { keys: ", / . · Ctrl+, / Ctrl+.", label: "Previous / next post" },
  { keys: "k · Ctrl+K", label: "Toggle keep tags between posts" },
  { keys: "m · Ctrl+M", label: "Merge into the exact/similar post (when found)" },
  { keys: "/", label: "Focus the tag input" },
  { keys: "Tab", label: "Accept the highlighted suggestion" },
  {
    keys: "Backspace",
    label:
      "Empty tag input: dismiss the pending new-tag card (without adding); otherwise remove the last tag / pool / implication",
  },
  { keys: "Esc", label: "Dismiss the popup" },
  { keys: "? · Ctrl+H", label: "Toggle this cheat sheet" },
];

// The merge route is entered by the Merge links next to the exact/similar
// post banners; m does the same without reaching for the mouse.
const router = useRouter();

const mergeTargetPostId = computed(() => {
  const exact = instanceSpecificData.value?.reverseSearchResult?.exactPostId;
  if (exact) return exact;
  return getSimilarPosts(instanceSpecificData.value?.reverseSearchResult)[0]?.id;
});

function openMerge() {
  if (mergeTargetPostId.value !== undefined && cfg.value.selectedSiteId) {
    router.push({
      name: "merge",
      params: { siteId: cfg.value.selectedSiteId, postId: String(mergeTargetPostId.value) },
    });
  }
}

function onTagInputBackspace() {
  // Backspace on the empty tag input: with a pending creation card it
  // cancels the newest one - dismissed WITHOUT adding the tag (Enter is the
  // confirm path). This is also the dismissal path for the card, because
  // Firefox closes the popup on Escape without the page ever seeing the key
  // (bugzilla 1443758) - Escape is never intercepted. Without a card it
  // removes the last tag.
  const lastCard = pendingTags.value.at(-1);
  if (lastCard) {
    dismissPendingTag(lastCard);
    return;
  }
  const last = pop.selectedPost?.tags.at(-1);
  if (last) removeTag(last);
}

function onPoolInputBackspace() {
  const last = pop.selectedPost?.pools.at(-1);
  if (last) removePool(last);
}

function toggleKeepTags() {
  // The checkbox only renders with more than one post; the shortcut matches
  // that so it cannot toggle an invisible option.
  if (pop.posts.length > 1) {
    cfg.value.popup.keepTagsBetweenPosts = !cfg.value.popup.keepTagsBetweenPosts;
  }
}

function selectNeighborPost(delta: -1 | 1) {
  const id = neighborPostId(pop.posts, pop.selectedPostId, delta);
  if (id !== undefined) pop.selectedPostId = id;
}

/**
 * Ctrl+Shift+Enter: upload, then move to the next grabbed post (the
 * selectedPostId watcher applies keep-tags / auto-search as usual); close the
 * popup when this was the last one. Duplicates advance immediately (upload()
 * was a deliberate no-op), errors stay so the banner remains visible.
 */
async function uploadAndAdvance() {
  const current = pop.selectedPost;
  const siteId = cfg.value.selectedSiteId;
  if (!current || !siteId) return;

  let attempt: UploadAttempt;
  try {
    attempt = await upload();
  } catch {
    return; // upload() already flipped the state to error
  }

  if (attempt == "duplicate") {
    advanceAfterUpload(current);
    return;
  }
  if (attempt != "sent") return; // busy: an in-flight upload keeps its own flow

  // Advance once the background confirms this post went through (App.vue
  // receives set_post_upload_info and mutates this state).
  const stop = watch(
    () => current.instanceSpecificData[siteId]?.uploadState?.state,
    (state) => {
      if (state == "uploaded") {
        stop();
        advanceAfterUpload(current);
      } else if (state == "error") {
        stop();
      }
    },
  );
}

function advanceAfterUpload(post: ScrapedPostDetails) {
  const nextId = neighborPostId(pop.posts, post.id, 1);
  if (nextId !== undefined) {
    pop.selectedPostId = nextId;
  } else {
    window.close();
  }
}

useKeyboardShortcuts(
  {
    primary: () => {
      if (pop.selectedPost) upload();
    },
    primaryAdvance: () => uploadAndAdvance(),
    cycleSafety: () => {
      if (pop.selectedPost) {
        pop.selectedPost.rating = cycleSafety(pop.selectedPost.rating);
      }
    },
    previousPost: () => selectNeighborPost(-1),
    nextPost: () => selectNeighborPost(1),
    toggleKeepTags,
    merge: openMerge,
    focusTagInput: () => tagInput.value?.focus(),
  },
  cheatsheetOpen,
);

useDark();
</script>

<template>
  <div class="popup-messages">
    <div class="messages">
      <!--
        Error messages
      -->

      <div v-if="cfg.sites.length == 0" class="bg-danger">
        <span>No szurubooru servers configured!</span>
      </div>

      <div v-if="!szuru && cfg.sites.length != 0" class="bg-danger">
        <span>No target server selected!</span>
      </div>

      <div v-if="instanceSpecificData?.reverseSearchResult?.exactPostId" class="bg-danger has-merge-button">
        <a :href="getActiveSitePostUrl(instanceSpecificData.reverseSearchResult?.exactPostId)">
          Post already uploaded ({{ instanceSpecificData.reverseSearchResult.exactPostId }})
        </a>

        <!-- TODO: Maybe a 5px gap here? -->

        <div style="display: flex; background: purple; border-radius: 0 2px 2px 0">
          <router-link
            :to="{
              name: 'merge',
              params: {
                siteId: cfg.selectedSiteId,
                postId: instanceSpecificData?.reverseSearchResult?.exactPostId,
              },
            }"
            style="padding: 5px 20px"
            >Merge</router-link
          >
        </div>
      </div>

      <!--
        Only show error when it's not undefined and not empty.
        TODO: Maybe remove this in favor of genericError?
      -->
      <div v-if="instanceSpecificData?.uploadState?.error?.length" class="bg-danger">
        <span>Couldn't upload post. {{ instanceSpecificData.uploadState.error }}</span>
      </div>

      <div v-if="instanceSpecificData?.genericError" class="bg-danger">
        <span>{{ instanceSpecificData.genericError }}</span>
      </div>

      <div v-if="pop.contextGrabError" class="bg-danger">
        <span>{{ pop.contextGrabError }}</span>
      </div>

      <!--
        Success messages
      -->

      <!-- TODO: Clicking a link doesn't actually open it in a new tab, see https://stackoverflow.com/questions/8915845 -->
      <div
        v-if="
          instanceSpecificData?.uploadState?.state == 'uploaded' && instanceSpecificData?.uploadState.instancePostId
        "
        class="bg-success"
      >
        <a :href="getActiveSitePostUrl(instanceSpecificData.uploadState.instancePostId)"
          >Uploaded post {{ instanceSpecificData.uploadState.instancePostId }}</a
        >
      </div>

      <div v-if="instanceSpecificData?.uploadState?.updateTagsState?.totalChanged" class="bg-success">
        <span>{{ getUpdatedTagsText(instanceSpecificData.uploadState?.updateTagsState?.totalChanged) }}</span>
      </div>

      <div v-if="instanceSpecificData?.uploadState?.createdTagsState?.totalCreated" class="bg-success">
        <span>{{ getCreatedTagsText(instanceSpecificData.uploadState?.createdTagsState?.totalCreated) }}</span>
      </div>

      <div v-if="instanceSpecificData?.uploadState?.tagCreationWarning" class="bg-warning">
        <span>{{ instanceSpecificData.uploadState.tagCreationWarning }}</span>
      </div>

      <!--
        Info messages
      -->

      <div v-if="instanceSpecificData?.uploadState?.state == 'uploading'"><span>Uploading...</span></div>

      <div v-if="isSearchingForSimilarPosts > 0 && instanceSpecificData?.uploadState == undefined">
        <span>Searching for similar posts...</span>
      </div>

      <div
        v-if="
          instanceSpecificData?.reverseSearchResult?.similarPosts.length == 0 &&
          instanceSpecificData.uploadState == undefined
        "
      >
        <span>No similar posts found</span>
      </div>

      <div
        v-for="similarPost in getSimilarPosts(instanceSpecificData?.reverseSearchResult)"
        :key="similarPost.id"
        class="has-merge-button"
      >
        <a :href="getActiveSitePostUrl(similarPost.id)"
          >Post {{ similarPost.id }} looks {{ similarPost.percentage }}% similar</a
        >

        <!-- TODO: Maybe a 5px gap here? -->

        <div style="display: flex; background: purple; border-radius: 0 2px 2px 0">
          <router-link
            :to="{
              name: 'merge',
              params: {
                siteId: cfg.selectedSiteId,
                postId: similarPost.id,
              },
            }"
            style="padding: 5px 20px"
            >Merge</router-link
          >
        </div>
      </div>
    </div>
  </div>

  <div v-if="pop.selectedPost" class="popup-columns" :class="{ mobile: isMobile }">
    <div class="popup-left">
      <PopupSection>
        <template #header>
          <span>Basic info</span>
          <AppIcon name="cog" class="cursor-pointer" @click="openOptionsPage" />
        </template>

        <div class="section-row" v-if="pop.selectedPost?.resolution || pop.selectedPost?.contentSize">
          <PostInfoSummary v-model="pop.selectedPost" />
        </div>

        <div class="section-row">
          <span class="section-label">Safety</span>

          <div style="display: flex; gap: 10px">
            <label>
              <input type="radio" value="safe" v-model="pop.selectedPost.rating" />
              Safe
            </label>

            <label>
              <input type="radio" value="sketchy" v-model="pop.selectedPost.rating" />
              Sketchy
            </label>

            <label>
              <input type="radio" value="unsafe" v-model="pop.selectedPost.rating" />
              Unsafe
            </label>
          </div>
        </div>

        <div v-if="cfg.popup.showSource" class="section-row">
          <span class="section-label">Source</span>
          <textarea v-model="pop.selectedPost.source"></textarea>
        </div>
      </PopupSection>

      <PopupSection header="Tags" toggleable v-model="cfg.popup.expandTags">
        <div class="section-row">
          <TagInput
            ref="tagInput"
            :szuru="szuru"
            :staged-tags="stagedTagInfos"
            @add-tag="addTagWithStaging"
            @backspace-on-empty="onTagInputBackspace"
          />
        </div>

        <div class="section-row" v-for="tag in pendingTags" :key="tag.name">
          <TagCreationCard
            :ref="(el) => setCardRef(tag.name, el)"
            :szuru="szuru"
            :tag-name="tag.name"
            :staged-tags="selectedStagedTagInfos"
            @confirm="(choice) => confirmStagedTag(tag, choice)"
            @skip="skipStagedTag(tag)"
          />
        </div>

        <div class="section-row" v-if="pop.posts.length > 1">
          <label>
            <input type="checkbox" v-model="cfg.popup.keepTagsBetweenPosts" />
            Keep tags between posts
          </label>
        </div>

        <div class="section-row">
          <CompactTags
            :tags="pop.selectedPost.tags"
            :show-remove-tag="true"
            :show-usages="cfg.loadTagCounts"
            @remove-tag="removeTag"
          />
        </div>
      </PopupSection>

      <PopupSection v-if="cfg.popup.showPools" header="Pools" toggleable v-model="cfg.popup.expandPools">
        <div class="section-row">
          <PoolInput :szuru="szuru" @add-pool="addPool" @backspace-on-empty="onPoolInputBackspace" />
        </div>

        <div class="section-row">
          <CompactPools
            :pools="pop.selectedPost.pools"
            :show-remove-pool="true"
            show-post-count
            @remove-pool="removePool"
          />
        </div>
      </PopupSection>

      <div v-if="cfg.popup.showInstancePicker" class="popup-section">
        <div class="section-row">
          <select v-model="cfg.selectedSiteId">
            <option v-for="site in cfg.sites" :key="site.id" :value="site.id">
              {{ site.domain }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div class="popup-right">
      <div class="popup-section">
        <select v-model="pop.selectedPostId">
          <!-- &#160;&#160; is used because duplicate space characters are usually removed by the browser. -->
          <option v-for="post in pop.posts" :key="post.id" :value="post.id">
            {{ post.name }} &#160;-&#160; {{ getPostInfoSummary(post) }}
          </option>
        </select>
      </div>

      <div class="popup-section">
        <div style="display: flex; gap: 5px">
          <button v-if="!cfg.autoSearchSimilar" class="primary" @click="clickFindSimilar">Find similar</button>
          <button class="primary full" title="Ctrl+Enter (Ctrl+Shift+Enter: import and advance)" @click="upload">
            Import
          </button>
          <!-- TODO: Add button to open this popup in fullscreen. -->
        </div>
      </div>

      <div class="popup-section">
        <PostContentDisplay
          :content-url="pop.selectedPost.contentUrl"
          :content-type="pop.selectedPost.contentType"
          :preview-url="pop.selectedPost.previewUrl"
          :playlist-url="pop.selectedPost.resolvedContent?.playlistUrl"
          @on-resolution-loaded="onResolutionLoaded"
        />
      </div>
    </div>
  </div>

  <div v-else class="p-3 flex items-center gap-3">
    <span>No content found</span>
    <AppIcon name="cog" class="cursor-pointer" @click="openOptionsPage" />
  </div>

  <ShortcutCheatsheet v-model="cheatsheetOpen" :shortcuts="shortcuts" />
</template>

<style scoped lang="scss">
.popup-left {
  flex: 1 0 300px;
}

.popup-right {
  flex: 1 1 auto;
}

.has-merge-button {
  display: flex;
  justify-content: space-between;
}
</style>
