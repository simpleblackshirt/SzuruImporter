<script lang="ts" setup>
import { cloneDeep } from "es-toolkit";
import SzurubooruApi from "~/api";
import { Post } from "~/api/models";
import { isMobile } from "~/env";
import { useRouter } from "vue-router";
import { BrowserCommand, PostUpdateCommandData, TagDetails } from "~/models";
import { cfg, useMergeStore, usePopupStore } from "~/stores";
import { emptyPost, ensurePostHasContentToken, getCreatedTagsText, getUrl } from "~/utils";
import { dedupeStaged, stripStagedImplications, toStagedInfos, type StagedTagInfo } from "~/utils/staged-tags";
import { encodeTagName } from "~/utils";
import { appendScrapedSource, mergeChangeset, scrapedMissingTags } from "../composables/mergeChangeset";
import { pushTagWithImplications } from "../composables/tagImplications";

const props = defineProps(["siteId", "postId"]);
const router = useRouter();
const merge = useMergeStore();
const pop = usePopupStore();

// Why is this cloneDeep needed? Or maybe it isn't?
const szuruConfig = cloneDeep(cfg.value.sites.find((x) => x.id == props.siteId))!;
const szuru = SzurubooruApi.createFromConfig(szuruConfig);

// Used for the update post request.
// Should NOT be edited by the user, as this is used to compute the changeset, e.g. "Tags: +1 / -3".
let existingPostRo: Post | undefined = undefined;

// Editable existing post.
const post = ref<Post>(emptyPost());

// Readonly scraped post.
const scrapedPost = pop.selectedPost;

// Stuff which the user can change.
const imageToKeep = ref<"current" | "new">("new");
const tagsToAdd = reactive([] as TagDetails[]);

// Staged (creation-card) entries currently queued in tagsToAdd. Drives the
// autocomplete merge and the staging validation.
const stagedTagInfos = computed<StagedTagInfo[]>(() => dedupeStaged(toStagedInfos(tagsToAdd)));

// Tags currently awaiting a creation-card decision.
const pendingTags = ref<TagDetails[]>([]);

// Component refs of the open cards, by tag name - a second Enter press
// (empty tag input) confirms the most recent pending card.
const cardRefs = new Map<string, { confirm: () => void }>();

function setCardRef(name: string, el: unknown) {
  if (el) {
    cardRefs.set(name, el as { confirm: () => void });
  } else {
    cardRefs.delete(name);
  }
}

// Computed stuff.
const sourcesAdded = ref(0);
const sourcesRemoved = ref(0);
// tagsAdded = tagsToAdd.length
const tagsRemoved = ref(0);

const contentUrl = computed(() => (imageToKeep.value == "current" ? post.value.contentUrl : scrapedPost?.contentUrl));

function removeExistingTag(tag: TagDetails) {
  const idx = post.value.tags.findIndex((x) => x.names == tag.names);
  if (idx != -1) {
    tagsRemoved.value++;
    post.value.tags.splice(idx, 1);
  }
}

function addTag(tag: TagDetails) {
  if (tag.name.length > 0) {
    // pushTagWithImplications skips the tag and each implication that the
    // predicate reports as present: either already queued in tagsToAdd or
    // already on the post's existing tags.
    pushTagWithImplications(
      tagsToAdd,
      tag,
      cfg.value.addTagImplications,
      (candidate) =>
        tagsToAdd.some((x) => x.name == candidate.name) ||
        post.value.tags.some((x) => x.names.indexOf(candidate.name) != -1),
    );
  }
}

/**
 * Same staging flow as PopupMain: a manually typed tag without instance data
 * gets an existence check - found, enrich and queue normally; not found,
 * open the creation card.
 */
async function addTagWithStaging(tag: TagDetails) {
  // Enter on an empty input with a pending card = "press that card's
  // button" (newest first, one press each) - see PopupMain.
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
    const res = await szuru?.getTags(encodeTagName(tag.name), 0, 1, ["names", "category", "usages", "implications"]);
    if (res && res.results.length > 0) {
      const instanceTag = res.results.find((x) => x.names.includes(tag.name));
      if (instanceTag) {
        addTag(TagDetails.fromTag(instanceTag));
      } else {
        addTag(tag);
      }
      return;
    }
  } catch (ex) {
    console.warn("Tag existence check failed:", ex);
  }

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

  // Staging only: created through the API when the merge is saved.
  tag.category = choice.category;
  tag.staged = { implications: choice.implications };
  pushTagWithImplications(
    tagsToAdd,
    tag,
    false,
    (candidate) =>
      tagsToAdd.some((x) => x.name == candidate.name) ||
      post.value.tags.some((x) => x.names.indexOf(candidate.name) != -1),
  );
}

function skipStagedTag(tag: TagDetails) {
  dismissPendingTag(tag);
  addTag(tag);
}

function removeTagToAdd(tag: TagDetails) {
  const idx = tagsToAdd.indexOf(tag);
  if (idx != -1) {
    tagsToAdd.splice(idx, 1);
  }

  if (tag.staged) {
    // Removal propagates: the tag itself already left tagsToAdd above, so
    // stripping its name from the remaining staged entries' implication
    // lists means a save can't resurrect it via the backend's auto-create.
    stripStagedImplications(tagsToAdd, tag.name);
  }
}

function appendSources() {
  if (scrapedPost) {
    post.value.source = appendScrapedSource(post.value.source, scrapedPost.source);
  }
}

function addMissingTags() {
  if (scrapedPost) {
    tagsToAdd.push(...scrapedMissingTags(post.value.tags, scrapedPost.tags));
  }
}

function mergeSafety() {
  if (scrapedPost) {
    post.value.safety = scrapedPost.rating;
  }
}

function getPostUrl(postId: number): string {
  return getUrl(szuruConfig.domain, "post", postId.toString());
}

async function mergeChanges() {
  // Re-entry guard: a merge already in flight (double-click or a second
  // Ctrl+Enter) must not fire another update command.
  if (merge.uploadInfo.some((x) => x.info.state == "uploading")) return;

  merge.genericError = undefined;

  if (!scrapedPost) {
    // Should never happend.
    merge.genericError = "Invalid state. 'scrapedPost' is falsy.";
    return;
  }

  if (!existingPostRo) {
    // Should only happen with an network error I guess?
    merge.genericError = "Invalid state. 'existingPostRo' is falsy.";
    return;
  }

  const { request: req, hasChanges } = await mergeChangeset(existingPostRo, scrapedPost, {
    edited: { source: post.value.source, safety: post.value.safety, tags: post.value.tags, tagsToAdd },
    imageToKeep: imageToKeep.value,
    selectedSiteId: cfg.value.selectedSiteId!,
    ensureContentToken: () => ensurePostHasContentToken(szuru, scrapedPost, cfg),
  });

  if (!hasChanges) {
    merge.genericError = "No changes to merge.";
    return;
  }

  merge.uploadInfo.push({
    instanceId: szuruConfig.id,
    postId: `merge-${existingPostRo.id}`,
    info: { state: "uploading", instancePostId: existingPostRo.id },
  });

  const cmdData = new PostUpdateCommandData(existingPostRo.id, req, szuruConfig, cloneDeep(tagsToAdd));
  const cmd = new BrowserCommand("update_post", cmdData);
  await browser.runtime.sendMessage(cmd);
}

watch(
  () => post.value.source,
  (_value, _oldValue) => {
    // TODO: Implement this.
    sourcesAdded.value = 0;
    sourcesRemoved.value = 0;
  },
);

watch(
  () => cfg.value.merge.addMissingTags,
  (value) => {
    if (value) {
      addMissingTags();
    } else if (existingPostRo) {
      tagsToAdd.splice(0);
    }
  },
);

watch(
  () => cfg.value.merge.appendSource,
  (value) => {
    if (value) {
      appendSources();
    } else if (existingPostRo) {
      post.value.source = existingPostRo.source;
    }
  },
);

watch(
  () => cfg.value.merge.mergeSafety,
  (value) => {
    if (value) {
      mergeSafety();
    } else if (existingPostRo) {
      post.value.safety = existingPostRo.safety;
    }
  },
);

onMounted(async () => {
  // Clear upload info and error.
  merge.uploadInfo.splice(0);
  merge.genericError = undefined;
  // Load existing post data.
  existingPostRo = await szuru?.getPost(props.postId);

  if (existingPostRo) {
    post.value = cloneDeep(existingPostRo);
    if (cfg.value.merge.appendSource) appendSources();
    if (cfg.value.merge.addMissingTags) addMissingTags();
    if (cfg.value.merge.mergeSafety) mergeSafety();

    if (scrapedPost?.resolution) {
      // Set imageToKeep depending on which image has the largest resolution.
      // TODO: Would be neat if this also uses the fileSize.
      const scrapedPx = scrapedPost.resolution[0] * scrapedPost.resolution[1];
      const existingPx = existingPostRo.canvasHeight * existingPostRo.canvasWidth;

      if (existingPx >= scrapedPx) {
        imageToKeep.value = "current";
      }
    }
  }
});

// Ctrl+Enter (Cmd+Enter on Mac) merges - same as the Merge changes button;
// the uploading guard in mergeChanges prevents re-entry.
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key == "Enter") {
    e.preventDefault();
    mergeChanges();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="popup-messages">
    <div class="messages">
      <div v-if="merge.genericError" class="bg-danger">
        <span>{{ merge.genericError }}</span>
      </div>

      <template v-for="data in merge.uploadInfo">
        <div :key="data.postId" v-if="data.info.state == 'uploaded' && data.info.instancePostId" class="bg-success">
          <a :href="getPostUrl(data.info.instancePostId)">Merged into post {{ data.info.instancePostId }}</a>
        </div>

        <div :key="data.postId + '-created'" v-if="data.info.createdTagsState?.totalCreated" class="bg-success">
          <span>{{ getCreatedTagsText(data.info.createdTagsState?.totalCreated) }}</span>
        </div>

        <div :key="data.postId" v-if="data.info.state == 'uploading'"><span>Merging...</span></div>

        <!-- Only show error when it's not undefined and not empty. -->
        <div :key="data.postId" v-if="data.info.error?.length" class="bg-danger">
          <span>Couldn't merge into post. {{ data.info.error }}</span>
        </div>

        <div :key="data.postId + '-warning'" v-if="data.info.tagCreationWarning?.length" class="bg-warning">
          <span>{{ data.info.tagCreationWarning }}</span>
        </div>
      </template>
    </div>
  </div>

  <div class="popup-columns" :class="{ mobile: isMobile }">
    <div class="popup-left">
      <div class="popup-section">
        <div style="display: flex; flex-direction: column; gap: 5px">
          <div style="display: flex; gap: 5px">
            <button class="bg-danger" @click="router.back()">
              <AppIcon name="chevron-left" class="cursor-pointer" @click="undefined" />
              Back
            </button>
            <div class="section-header full">
              <span>Merge into post #{{ props.postId }}</span>
            </div>
          </div>

          <button class="primary full" title="Ctrl+Enter" @click="mergeChanges">Merge changes</button>
        </div>
      </div>

      <PopupSection header="Changes">
        <div class="section-row">
          <ul class="compact-tags">
            <li v-show="tagsToAdd.length != 0 || tagsRemoved != 0">
              Tags: <span class="success" v-show="tagsToAdd.length != 0">+{{ tagsToAdd.length }}</span>
              <span class="danger" v-show="tagsRemoved != 0">-{{ tagsRemoved }}</span>
            </li>
            <li v-show="sourcesAdded != 0 || sourcesRemoved != 0">
              Sources: <span class="success" v-show="sourcesAdded != 0">+2</span>
              <span class="danger" v-show="sourcesRemoved != 0">-1</span>
            </li>
            <li v-show="existingPostRo?.safety != post.safety">
              Safety: <s class="danger">{{ existingPostRo?.safety }}</s> <span class="success">{{ post.safety }}</span>
            </li>
            <li v-show="imageToKeep == 'new'">
              <span class="success">Updating post content</span>
            </li>

            <!-- TODO: Add "No changes" text. -->
          </ul>
        </div>
      </PopupSection>

      <PopupSection header="Basic info">
        <div class="section-row">
          <span class="section-label">Safety</span>

          <div style="display: flex; gap: 10px">
            <label>
              <input type="radio" value="safe" v-model="post.safety" />
              Safe
            </label>

            <label>
              <input type="radio" value="sketchy" v-model="post.safety" />
              Sketchy
            </label>

            <label>
              <input type="radio" value="unsafe" v-model="post.safety" />
              Unsafe
            </label>
          </div>
        </div>

        <div class="section-row">
          <span class="section-label">Source</span>
          <!-- TODO: Fix this -->
          <textarea v-model="post.source"></textarea>
        </div>
      </PopupSection>

      <PopupSection header="Existing tags" toggleable v-model="cfg.merge.expandExistingTags">
        <div class="section-row">
          <CompactTags
            :tags="post.tags.map((x) => TagDetails.fromMicroTag(x))"
            :show-remove-tag="true"
            :show-usages="true"
            @remove-tag="removeExistingTag"
          />
        </div>
      </PopupSection>

      <PopupSection header="Tags to add" toggleable v-model="cfg.merge.expandAddTags">
        <div class="section-row">
          <TagInput :szuru="szuru" :staged-tags="stagedTagInfos" @add-tag="addTagWithStaging" />
        </div>

        <div class="section-row" v-for="tag in pendingTags" :key="tag.name">
          <TagCreationCard
            :ref="(el) => setCardRef(tag.name, el)"
            :szuru="szuru"
            :tag-name="tag.name"
            :staged-tags="stagedTagInfos"
            @confirm="(choice) => confirmStagedTag(tag, choice)"
            @skip="skipStagedTag(tag)"
          />
        </div>

        <div class="section-row">
          <CompactTags :tags="tagsToAdd" :show-remove-tag="true" :show-usages="true" @remove-tag="removeTagToAdd" />
        </div>
      </PopupSection>
    </div>

    <div class="popup-right">
      <PopupSection header="Content">
        <div class="section-row">
          <div style="display: flex; gap: 10px; margin: 10px 0">
            <label>
              <input type="radio" value="current" v-model="imageToKeep" />
              Current ({{ post.canvasWidth }}x{{ post.canvasHeight }})
            </label>

            <!-- TODO: Also display filesize -->

            <label>
              <input type="radio" value="new" v-model="imageToKeep" />
              New ({{ scrapedPost?.resolution?.[0] }}x{{ scrapedPost?.resolution?.[1] }})
            </label>
          </div>

          <PostContentDisplay :content-url="contentUrl" content-type="image" />
        </div>
      </PopupSection>

      <PopupSection header="Merge options" toggleable v-model="cfg.merge.expandOptions">
        <div class="section-row">
          <div style="display: flex; flex-direction: column">
            <label>
              <input type="checkbox" v-model="cfg.merge.addMissingTags" />
              Add missing tags
            </label>

            <label>
              <input type="checkbox" v-model="cfg.merge.appendSource" />
              Append source
            </label>

            <label>
              <input type="checkbox" v-model="cfg.merge.mergeSafety" />
              Merge safety
            </label>
          </div>
        </div>
      </PopupSection>
    </div>
  </div>
</template>

<style scoped lang="scss">
.popup-left {
  flex: 1 1 auto;
}

.popup-right {
  flex: 1 0 300px;
}
</style>
