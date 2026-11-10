<script setup lang="ts">
import { useDark } from "@vueuse/core";
import {
  getUrl,
  getPostInfoSummary,
} from "~/utils";
import {
  TagDetails,
  PoolDetails,
} from "~/models";
import { isMobile } from "~/env";
import { cfg, usePopupStore } from "~/stores";
import SzurubooruApi from "~/api";
import { getSimilarPosts } from "../composables/similarPosts";
import { useSimilarSearch } from "../composables/useSimilarSearch";
import { useTagCounts } from "../composables/useTagCounts";
import { useContentInfo } from "../composables/useContentInfo";
import { useGrabPost } from "../composables/useGrabPost";
import { useUpload } from "../composables/useUpload";
import { pushTagWithImplications } from "../composables/tagImplications";
import { clearStagedState, dedupeStaged, stripStagedImplications, toStagedInfos, type StagedTagInfo } from "~/utils/staged-tags";
import { encodeTagName, getCreatedTagsText } from "~/utils";

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
const stagedTagInfos = computed<StagedTagInfo[]>(() =>
  dedupeStaged(pop.posts.flatMap((x) => toStagedInfos(x.tags))),
);

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

// (Reactive) shorthand for `main.selectedPost.instanceSpecificData.get(config.selectedSiteId)`.
// This should only be used as if it were readonly, because the instanceId might change.
const instanceSpecificData = readonly(
  computed(() => {
    if (pop.selectedPost && cfg.value.selectedSiteId) {
      return pop.selectedPost.instanceSpecificData[cfg.value.selectedSiteId];
    }
  }),
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

    // Call findSimilar if wanted.
    if (cfg.value.autoSearchSimilar && enableAutoSearch.value) {
      let selectedPost = pop.posts.find((x) => x.id == value);
      if (selectedPost) findSimilar(selectedPost);
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
      // Call findSimilar if wanted.
      if (cfg.value.autoSearchSimilar && pop.selectedPost) {
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
  if (!pop.selectedPost || tag.name.length == 0) return;

  if (!cfg.value.stagedTagCreation || tag.staged || tag.category !== undefined || tag.usages !== undefined) {
    addTag(tag);
    return;
  }

  try {
    const res = await szuru.value?.getTags(encodeTagName(tag.name), 0, 1, ["names", "category", "usages", "implications"]);
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

function confirmStagedTag(tag: TagDetails, choice: { category: string; implications: string[] }) {
  dismissPendingTag(tag);
  if (!pop.selectedPost) return;

  // Staging only: optimistic local state, zero server writes. The tag is
  // created through the API when the post is saved.
  tag.category = choice.category;
  tag.staged = { implications: choice.implications };
  // No client-side implication expansion for staged tags: their implications
  // materialize server-side at save time.
  pushTagWithImplications(pop.selectedPost.tags, tag, false);
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
          <TagInput :szuru="szuru" :staged-tags="stagedTagInfos" @add-tag="addTagWithStaging" />
        </div>

        <div
          class="section-row"
          v-for="tag in pendingTags"
          :key="tag.name"
        >
          <TagCreationCard
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
          <PoolInput :szuru="szuru" @add-pool="addPool" />
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
          <button class="primary full" @click="upload">Import</button>
          <!-- TODO: Add button to open this popup in fullscreen. -->
        </div>
      </div>

      <div class="popup-section">
        <PostContentDisplay
          :content-url="pop.selectedPost.contentUrl"
          :content-type="pop.selectedPost.contentType"
          @on-resolution-loaded="onResolutionLoaded"
        />
      </div>
    </div>
  </div>

  <div v-else class="p-3 flex items-center gap-3">
    <span>No content found</span>
    <AppIcon name="cog" class="cursor-pointer" @click="openOptionsPage" />
  </div>
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
