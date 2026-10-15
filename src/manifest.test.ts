import { afterEach, describe, expect, it, vi } from "vitest";

const envStack: Array<Record<string, string | undefined>> = [];

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of ["NODE_ENV", "SZ_GECKO_ID"]) {
    if (env[key] === undefined) {
      // vitest loads .env into process.env (SZ_GECKO_ID exists on dev machines);
      // assigning undefined would coerce to the truthy string "undefined".
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
}

/**
 * getManifest() reads NODE_ENV (via scripts/utils' module-level isDev) and SZ_GECKO_ID,
 * so every variant gets a fresh module evaluation under its own env.
 */
async function getManifestUnder(env: Record<string, string | undefined>) {
  envStack.push({ NODE_ENV: process.env.NODE_ENV, SZ_GECKO_ID: process.env.SZ_GECKO_ID });
  applyEnv(env);
  vi.resetModules();
  const { getManifest } = await import("./manifest");
  return getManifest();
}

afterEach(() => {
  const prev = envStack.pop();
  if (prev) {
    applyEnv(prev);
  }
});

describe("MV3 manifest (chromium variant, production)", () => {
  it("should be manifest_version 3 with action instead of browser_action", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action?.default_popup).toBe("./dist/popup/index.html");
    expect(manifest.browser_action).toBeUndefined();
  });

  it("should declare the dual cross-browser background pointing at one built script", async () => {
    // mv3-facts W1: Chromium >= 121 ignores `scripts`, Firefox >= 121 ignores
    // `service_worker`; the file must exist at exactly the manifest-declared path.
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(manifest.background).toEqual({
      scripts: ["dist/background/index.js"],
      service_worker: "dist/background/index.js",
    });
  });

  it("should split host permissions and prune the MV2 webRequest permissions", async () => {
    // Failure mode: registering a blocking webRequest listener without
    // webRequestBlocking throws at load and the extension fails to start.
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.permissions).not.toContain("<all_urls>");
    expect(manifest.permissions).not.toContain("webRequest");
    expect(manifest.permissions).not.toContain("webRequestBlocking");
    for (const required of ["storage", "activeTab", "notifications", "declarativeNetRequest"]) {
      expect(manifest.permissions).toContain(required);
    }
  });

  it("should use the MV3 CSP object form, self-only for shipped builds", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(typeof manifest.content_security_policy).toBe("object");
    expect(manifest.content_security_policy).toHaveProperty("extension_pages", "script-src 'self'; object-src 'self'");
  });

  it("should keep the static content script declaration for production", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(manifest.content_scripts).toEqual([
      { matches: ["http://*/*", "https://*/*"], js: ["./dist/contentScripts/index.global.js"] },
    ]);
  });

  it("should pin the chromium version floor", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(manifest.minimum_chrome_version).toBe("127.0");
  });

  it("should omit browser_specific_settings without SZ_GECKO_ID", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "production" });

    expect(manifest.browser_specific_settings).toBeUndefined();
  });
});

describe("MV3 manifest (gecko variant)", () => {
  it("should wrap the gecko id and pin the firefox version floor for gecko and gecko_android", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "production", SZ_GECKO_ID: "some-uuid" });

    const gecko = manifest.browser_specific_settings?.gecko as any;
    const geckoAndroid = manifest.browser_specific_settings?.gecko_android as any;
    expect(gecko.id).toBe("{some-uuid}");
    expect(gecko.strict_min_version).toBe("127.0");
    expect(geckoAndroid.strict_min_version).toBe("127.0");
  });

  it("should keep the Firefox-gated blocking webRequest permissions for the referer listeners", async () => {
    // mv3-facts W1: Firefox MV3 still allows blocking webRequest.onBeforeSendHeaders;
    // the listeners auto-revive there via the hasWebRequestBlocking() runtime gate.
    // Chromium prunes both permissions and uses DNR session rules instead.
    const manifest = await getManifestUnder({ NODE_ENV: "production", SZ_GECKO_ID: "some-uuid" });

    expect(manifest.permissions).toContain("webRequest");
    expect(manifest.permissions).toContain("webRequestBlocking");
  });
});

describe("MV3 manifest (development variant)", () => {
  it("should permit the vite dev server via the MV3 CSP object localhost exception", async () => {
    const manifest = await getManifestUnder({ NODE_ENV: "development" });

    const csp = manifest.content_security_policy as any;
    expect(typeof csp).toBe("object");
    expect(csp.extension_pages).toContain("http://localhost:3303");
  });

  it("should swap static content scripts for the dev injection permissions", async () => {
    // mv3-facts W1: tabs.executeScript is MV2-only on both browsers - the dev
    // contentScriptHMR hook needs `scripting` (+ webNavigation for onCommitted).
    const manifest = await getManifestUnder({ NODE_ENV: "development" });

    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.permissions).toContain("webNavigation");
  });
});
