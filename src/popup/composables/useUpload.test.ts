import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const testCtx = vi.hoisted(() => {
  const browserStub = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
  return { browserStub };
});

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

import { cfg, usePopupStore } from "~/stores";
import { useUpload } from "./useUpload";

const SITE_ID = "test-site";

function makeSelectedPost() {
  return {
    id: "post-1",
    contentUrl: "https://cdn.example.com/img.jpg",
    pageUrl: "",
    contentType: "image",
    rating: "safe",
    sources: [],
    tags: [],
    notes: [],
    uploadMode: "url",
    instanceSpecificData: {} as Record<string, any>,
  };
}

async function makeComposable(post = makeSelectedPost()) {
  setActivePinia(createPinia());
  const pop = usePopupStore();
  pop.posts.push(post as any);
  pop.selectedPostId = post.id;
  cfg.value.selectedSiteId = SITE_ID;
  // Not exercised by url-mode posts before the message send; provided for the
  // deps contract only.
  const szuru = { value: {} };
  const selectedSite = { value: { id: SITE_ID } };
  const composable = useUpload({ szuru: szuru as any, selectedSite: selectedSite as any });
  return { pop, ...composable };
}

beforeEach(() => {
  vi.clearAllMocks();
  testCtx.browserStub.runtime.sendMessage.mockResolvedValue(undefined);
});

describe("upload pipeline gate", () => {
  it("is busy while the grab pipeline is running and sends nothing", async () => {
    const { pop, upload } = await makeComposable();
    pop.grabPipelineRunning = true;

    const attempt = await upload();

    expect(attempt).toBe("busy");
    expect(testCtx.browserStub.runtime.sendMessage).not.toHaveBeenCalled();
    expect(pop.selectedPost?.instanceSpecificData[SITE_ID]).toBeUndefined();
  });

  it("sends the upload once the pipeline has settled", async () => {
    const { upload } = await makeComposable();

    const attempt = await upload();

    expect(attempt).toBe("sent");
    expect(testCtx.browserStub.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ name: "upload_post" }),
    );
  });
});
