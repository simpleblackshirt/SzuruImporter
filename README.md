# SzuruChrome

Chrome/Firefox extension which can import media from various sites into a [szurubooru](https://github.com/rr-/szurubooru) instance.

![Screenshot](./docs/screenshots/Default%20-%20Existing%20post%20found.png)

## Installation

### Firefox

I am experimenting with publishing the extension to Firefox Add-ons. You can find it [here](https://addons.mozilla.org/en-US/firefox/addon/szuruchrome/). This version will automatically update.

You can also download the .xpi from the [release tab](https://github.com/neobooru/SzuruChrome/releases) and manually install it. This version will not automatically update.

Both versions can be installed side by side, as they do not affect each other. This also means that you need to configure both of them independently.

### Chrome

I can't create a valid .crx file, which means that you'll have to use [Chrome's "Load unpacked extension"](https://developer.chrome.com/docs/extensions/mv3/getstarted/#unpacked) feature.
You can download a .zip containing the needed files from the [release tab](https://github.com/neobooru/SzuruChrome/releases). Check [this Stack Overflow answer](https://stackoverflow.com/a/38011386) if you want to get rid of the developer extension popup.

## Build/debug

```sh
# Install node modules
pnpm install

# Live dev build (watch)
pnpm dev

# Production build
pnpm build
```

After this you can load them in your browser.  
Chrome: `chrome://extensions/` → "Load unpacked" → Select the `./extension` folder  
Firefox: `about:debugging` → "Load Temporary Add-on..." → Select `./extension/manifest.json`

> **Build variant note:** `scripts/manifest.ts` loads `.env`, so on a machine with `SZ_GECKO_ID` set a bare
> `pnpm build` produces the **gecko** variant (gecko id + `webRequestBlocking`). For a clean Chromium build,
> shadow it: `$env:SZ_GECKO_ID=''; pnpm build`. CI/packaging for Chrome must do the same.

### Development & hot reload (MV3)

`pnpm dev` starts three things at once:

| Process | What it does |
| --- | --- |
| `dev:prepare` | Writes `extension/manifest.json` and the popup/options stub `index.html` files that point at the dev server; watches `src/manifest.ts` and re-writes the manifest on change. |
| `dev:web` | Vite dev server on `http://localhost:3303` — serves popup and options for real HMR. |
| `dev:js` | Parallel watch builds: `dev:js:content` → `extension/dist/contentScripts/index.global.js`, `dev:js:background` → `extension/dist/background/index.js`. |

Reload behavior per surface:

- **Popup / options**: full dev-server HMR. The dev manifest CSP adds the `http://localhost:3303` script-src exception (MV3 localhost exception; Firefox requires temporary add-on load and 147+ for it), so changes hot-swap without touching the extension. Load the extension once, then open the popup/options pages as usual.
- **Background (service worker / event page)**: an MV3 background cannot load its script from the dev server (same-origin rule), so there is **no HMR socket** — the background is a plain rebuilt file. When `src/background/**` changes, `dev:js:background` rewrites `extension/dist/background/index.js`; run `pnpm start:chromium` or `pnpm start:firefox` (web-ext run) in a second terminal and it reloads the extension automatically on every rebuild. Without web-ext, reload manually: `chrome://extensions/` → refresh icon, or `about:debugging` → "Reload".
- **Content scripts**: `dev:js:content` rebuilds on change; the dev-only background hook (`src/background/contentScriptHMR.ts`) injects the freshly built bundle into every web page on navigation via `browser.scripting.executeScript`, so a page reload picks up content-script changes. (Firefox caches content scripts, which is why injection happens per navigation instead of relying on the manifest declaration in dev.)

```sh
# Terminal 1
pnpm dev

# Terminal 2 (optional): load + auto-reload the extension on rebuilds
pnpm start:chromium   # or: pnpm start:firefox
```

The production flow (`pnpm build`) bundles the background as a single self-contained classic script (`vite.config.background.ts`) — required because the MV3 manifest declares the same file for Chromium's service worker and Firefox's event-page `background.scripts` (Firefox has no extension service workers), and neither form resolves ES module imports.

### MV3 background runtime decisions

**Referer for hotlink-protected media (sinaimg.cn, i.pximg.net).** These CDNs answer 403 without their site's Referer, but only requests initiated by the extension itself may be rewritten (never normal browsing). Per-browser mechanism:

- **Chromium**: `declarativeNetRequest` **session** rules set the Referer (`modifyHeaders`) for requests matching `tabIds: [TAB_ID_NONE]` (requests not originating from any tab = extension-initiated) plus `requestDomains` + `resourceTypes`. Rules are re-registered idempotently on every service-worker wake (`src/webRequest/dnrReferer.ts`, wired in `src/background/main.ts`); session rules survive SW restarts and are cleared at browser shutdown/extension update, so no static ruleset exists. DNR applies to the SW's own fetches regardless of `credentials: 'include'`.
- **Firefox (divergence)**: Firefox MV3 still allows blocking `webRequest.onBeforeSendHeaders`, so the gecko manifest ships `webRequest` + `webRequestBlocking` and the same listeners as before run there (`src/webRequest/referer.ts`, `src/webRequest/popupReferrer.ts`), auto-revived at runtime by checking the manifest permissions. The Chromium variants prune both permissions.
- **Popup media previews**: same mechanisms cover the popup's `<img>` display (DNR `TAB_ID_NONE` on Chromium, blocking webRequest on Firefox). Chromium caveat: popup requests should report `TAB_ID_NONE` (no tab exists); whether action-popup requests actually do must be confirmed at runtime (check that a weibo/pixiv media preview renders in the popup).

The full wave-3 write-up (incl. runtime-verification steps) lives in `docs/plan/20261015-mv3-migration/t3-mv3-background-runtime.md` (local working notes).

See [the developer notes](https://github.com/neobooru/SzuruChrome/wiki/Developer-notes) for more information.
