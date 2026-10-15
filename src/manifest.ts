import fs from "fs-extra";
import type { Manifest } from "webextension-polyfill";
import type PkgType from "../package.json";
import { isDev, port, r } from "../scripts/utils";

// MV3 background entry, built as one self-contained classic script by vite.config.background.ts.
// Dual-key cross-browser pattern (mv3-facts W1): Chromium >= 121 ignores `scripts`, Firefox >= 121
// ignores `service_worker` (Firefox has no extension service workers - bugzil.la/1573659).
const backgroundScript = "dist/background/index.js";

export async function getManifest() {
  const pkg = (await fs.readJSON(r("package.json"))) as typeof PkgType;

  // update this file to update this manifest.json
  // can also be conditional based on your need
  const manifest: Manifest.WebExtensionManifest = {
    name: pkg.displayName,
    description: pkg.description,
    version: process.env.VITE_SZ_VERSION || pkg.version,
    manifest_version: 3,
    icons: {
      16: "./assets/icon-16.png",
      48: "./assets/icon-48.png",
      128: "./assets/icon-128.png",
    },
    action: {
      default_title: pkg.displayName,
      default_popup: "./dist/popup/index.html",
    },
    options_ui: {
      page: "./dist/options/index.html",
      open_in_tab: true,
      chrome_style: false,
    },
    // The @types union predates the MDN-endorsed dual {scripts, service_worker} form.
    background: {
      scripts: [backgroundScript],
      service_worker: backgroundScript,
    } as Manifest.WebExtensionManifest["background"],
    // MV3 splits host permissions out of `permissions`.
    permissions: ["storage", "activeTab", "notifications", "declarativeNetRequest"],
    host_permissions: ["<all_urls>"],
    content_scripts: [
      {
        matches: ["http://*/*", "https://*/*"],
        js: ["./dist/contentScripts/index.global.js"],
      },
    ],
    // MV3 CSP is an object; shipped builds must be 'self'-only (mv3-facts W1).
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    // 127.0 Chromium floor (mv3-facts W1): action.openPopup stable in 127; supersedes the
    // 121 dual-background requirement, DNR modifyHeaders (86) and scripting (88).
    minimum_chrome_version: "127.0",
  };

  if (process.env.SZ_GECKO_ID) {
    manifest.browser_specific_settings = {
      gecko: {
        id: `{${process.env.SZ_GECKO_ID}}`,
        // 127.0 Firefox floor (mv3-facts W1): MV3 host_permissions + dual background usable
        // since 121-127; openPopup (109+) is gesture-gated before 149 and wave 3 ships a
        // try/catch review-tab fallback, so 149 is not a hard requirement.
        strict_min_version: "127.0",
      },
      gecko_android: {
        strict_min_version: "127.0",
      },
    };

    // Firefox MV3 keeps blocking webRequest (mv3-facts W1) - the referer
    // listeners auto-revive via the hasWebRequestBlocking() runtime gate.
    // Chromium prunes both permissions and uses DNR session rules instead.
    manifest.permissions?.push("webRequest", "webRequestBlocking");
  }

  if (isDev) {
    // for content script, as browsers will cache them for each reload,
    // we use a background script to always inject the latest version
    // see src/background/contentScriptHMR.ts
    delete manifest.content_scripts;
    // scripting: tabs.executeScript is MV2-only on both browsers (mv3-facts W1);
    // webNavigation: the dev injector hooks onCommitted.
    manifest.permissions?.push("webNavigation", "scripting");

    // MV3 CSP object form; the localhost exception is valid for Chrome unpacked and
    // Firefox temporarily-loaded 147+ (mv3-facts W1). Deliberately no
    // upgrade-insecure-requests so the plain ws:// vite HMR socket keeps working.
    manifest.content_security_policy = {
      extension_pages: `script-src 'self' http://localhost:${port}; object-src 'self'`,
    };
  }

  return manifest;
}
