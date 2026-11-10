import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * uploadPost's server-download fallback: url-mode posts hand the contentUrl
 * to the szurubooru server, and hotlink-protected sources (twimg, sinaimg,
 * pximg, ...) reject server fetches with e.g. "Download target returned HTTP
 * 403. (Forbidden)" (a szurubooru DownloadError). The background must retry
 * such uploads once with a client-side download + temp-file token.
 */

const testCtx = vi.hoisted(() => {
  const createPost = vi.fn();
  const uploadTempFileFromContent = vi.fn();
  // The upload flow's tag-existence pre-check (created-tags counting); an
  // empty result = no tag on the instance = all post tags count as new.
  const getTags = vi.fn().mockResolvedValue({ results: [] });

  const browserStub = {
    runtime: {
      getURL: (path: string) => `moz-extension://test-uuid/${path.replace(/^\//, "")}`,
      getManifest: () => ({ manifest_version: 3, permissions: [] }),
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    notifications: { onClicked: { addListener: vi.fn() }, create: vi.fn(), clear: vi.fn() },
    // Explicitly undefined, not omitted: vitest's mocked-module namespace
    // THROWS on accesses to keys the factory never returned, while a defined-
    // undefined key reads as "namespace absent" - the Android case the guards
    // in main.ts/contextMenu.ts exist for. This exercises exactly that path.
    contextMenus: undefined as any,
    tabs: { TAB_ID_NONE: -1, create: vi.fn() },
    // The dev-only contentScriptHMR dynamic import fires on every module load
    // (same shape as main.test.ts's stub).
    webNavigation: { onCommitted: { addListener: vi.fn() } },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    declarativeNetRequest: { updateSessionRules: vi.fn().mockResolvedValue(undefined) },
    storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  };

  return { createPost, uploadTempFileFromContent, getTags, browserStub };
});

vi.mock("~/api", () => ({
  default: {
    createFromConfig: () => ({
      createPost: testCtx.createPost,
      uploadTempFileFromContent: testCtx.uploadTempFileFromContent,
      getTags: testCtx.getTags,
    }),
  },
}));

// unplugin-auto-import turns the global `browser` into an import of webextension-polyfill,
// which throws outside of a real extension environment.
vi.mock("webextension-polyfill", () => testCtx.browserStub);

import { BrowserCommand, PostUploadCommandData } from "~/models";

const site = {
  id: "site-1",
  domain: "https://szuru.example.org",
  username: "user",
  authToken: "token",
} as any;

const makePost = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "post-1",
    contentUrl: "https://pbs.twimg.com/media/ABC?format=jpg&name=orig",
    tags: [],
    pools: [],
    instanceSpecificData: { "site-1": {} },
    ...overrides,
  }) as any;

const downloadError = {
  name: "DownloadError",
  title: "Download error",
  description: "Download target returned HTTP 403. (Forbidden)",
};

/** Imports main.ts fresh and returns the background's message handler. */
async function initMain() {
  vi.resetModules();
  await import("./main");
  await new Promise((resolve) => setTimeout(resolve, 0)); // drain fire-and-forget DNR registration
  return testCtx.browserStub.runtime.onMessage.addListener.mock.calls.at(-1)![0] as (
    cmd: BrowserCommand,
  ) => Promise<any>;
}

const uploadCmd = (post: any) => new BrowserCommand("upload_post", new PostUploadCommandData(post, site, false));

const pushInfoCalls = () =>
  testCtx.browserStub.runtime.sendMessage.mock.calls
    .map((call) => call[0])
    .filter((cmd: BrowserCommand) => cmd.name == "set_post_upload_info");

beforeEach(() => {
  vi.clearAllMocks();
  testCtx.browserStub.runtime.sendMessage.mockResolvedValue(undefined);
  testCtx.browserStub.declarativeNetRequest.updateSessionRules.mockResolvedValue(undefined);
});

describe("url-mode server-download fallback", () => {
  it("retries a DownloadError once with a client-side download + temp-file token", async () => {
    const handler = await initMain();
    testCtx.createPost.mockRejectedValueOnce(downloadError).mockResolvedValueOnce({ id: 42, tags: [] });
    testCtx.uploadTempFileFromContent.mockResolvedValue({ token: "tmp-token" });

    await handler(uploadCmd(makePost()));

    // First attempt without a token (url-mode), retry with the temp-file token.
    expect(testCtx.createPost).toHaveBeenCalledTimes(2);
    expect(testCtx.createPost.mock.calls[0][1]).toBeUndefined();
    expect(testCtx.createPost.mock.calls[1][1]).toBe("tmp-token");
    expect(testCtx.uploadTempFileFromContent).toHaveBeenCalledTimes(1);
    expect(testCtx.uploadTempFileFromContent).toHaveBeenCalledWith(makePost().contentUrl);

    // The retry succeeded: the popup is told the post was uploaded.
    const lastPush = pushInfoCalls().at(-1);
    expect(lastPush.data.info.state).toBe("uploaded");
    expect(lastPush.data.info.instancePostId).toBe(42);
  });

  it("does not retry content-mode posts (token present)", async () => {
    const handler = await initMain();
    testCtx.createPost.mockRejectedValue(downloadError);

    await handler(uploadCmd(makePost({ instanceSpecificData: { "site-1": { contentToken: "existing" } } })));

    expect(testCtx.createPost).toHaveBeenCalledTimes(1);
    expect(testCtx.createPost.mock.calls[0][1]).toBe("existing");
    expect(testCtx.uploadTempFileFromContent).not.toHaveBeenCalled();

    const lastPush = pushInfoCalls().at(-1);
    expect(lastPush.data.info.state).toBe("error");
    expect(lastPush.data.info.error).toBe(downloadError.description);
  });

  it("does not retry non-download errors (e.g. PostAlreadyUploadedError)", async () => {
    const handler = await initMain();
    testCtx.createPost.mockRejectedValue({ name: "PostAlreadyUploadedError", otherPostId: 7 });

    await handler(uploadCmd(makePost()));

    expect(testCtx.createPost).toHaveBeenCalledTimes(1);
    expect(testCtx.uploadTempFileFromContent).not.toHaveBeenCalled();
    // The exact-post-id path must still work for this error class.
    const exactPush = testCtx.browserStub.runtime.sendMessage.mock.calls
      .map((call) => call[0])
      .find((cmd: BrowserCommand) => cmd.name == "set_exact_post_id");
    expect(exactPush?.data.exactPostId).toBe(7);
  });

  it("keeps PostAlreadyUploadedError identity when the RETRY creates an exact duplicate", async () => {
    const handler = await initMain();
    testCtx.createPost
      .mockRejectedValueOnce(downloadError)
      .mockRejectedValueOnce({ name: "PostAlreadyUploadedError", otherPostId: 99 });
    testCtx.uploadTempFileFromContent.mockResolvedValue({ token: "tmp-token" });

    await handler(uploadCmd(makePost()));

    expect(testCtx.uploadTempFileFromContent).toHaveBeenCalledTimes(1);
    const exactPush = testCtx.browserStub.runtime.sendMessage.mock.calls
      .map((call) => call[0])
      .find((cmd: BrowserCommand) => cmd.name == "set_exact_post_id");
    expect(exactPush?.data.exactPostId).toBe(99);
    // No generic error message: the exact-post-id banner takes over.
    const lastPush = pushInfoCalls().at(-1);
    expect(lastPush.data.info.error).toBeUndefined();
  });

  it("surfaces the client-side download failure when the retry download also fails", async () => {
    const handler = await initMain();
    testCtx.createPost.mockRejectedValueOnce(downloadError);
    testCtx.uploadTempFileFromContent.mockRejectedValue({
      message: "Fetching 'https://pbs.twimg.com/media/ABC?format=jpg&name=orig' failed with status 403.",
    });

    await handler(uploadCmd(makePost()));

    expect(testCtx.createPost).toHaveBeenCalledTimes(1);
    const lastPush = pushInfoCalls().at(-1);
    expect(lastPush.data.info.state).toBe("error");
    expect(lastPush.data.info.error).toContain("failed with status 403");
  });
});
