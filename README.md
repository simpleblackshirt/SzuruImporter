# Szuru Importer

Chrome/Firefox extension which can import media from various sites into a [szurubooru](https://github.com/rr-/szurubooru) instance.

![Screenshot](./docs/screenshots/Default%20-%20Existing%20post%20found.png)

Fork of [neobooru/SzuruChrome](https://github.com/neobooru/SzuruChrome). Improvements compared to upstream:

- **Manifest V3 migration** for Chromium and Firefox, with per-browser referer handling for hotlink-protected CDNs (`declarativeNetRequest` session rules on Chromium, blocking `webRequest` on Firefox)
- **Context-menu element grabbing** — right-click any image/video/link to grab just that element; grabs are stashed and picked up by the popup when opened, and raw CDN URLs are rewritten to fetchable ones (page grabs are only offered on sites with a matching scraper)
- **Site adapter registry** covering all 22 [neo-scraper](https://github.com/simpleblackshirt/neo-scraper) engines, with source dedup across host-site families (e.g. weibo/sinaimg)
- **New engines via the neo-scraper fork**: Lofter, Weibo, Xiaohongshu, plus Bluesky tags — and engine accuracy fixes across Twitter, Pixiv, Weibo, Xiaohongshu, Lofter, and Bluesky
- **Tag handling**: tag categories filled from the backend so known tags show colored, plus an optional setting to replace existing aliases with primary tag names
- **Refactoring and package updates**: composables extracted from the popup (grab/upload/tag counts/similar search/content info/merge changeset), ESLint 10 flat config, PrimeVue 5, Pinia 4, Vitest 5, and dependency majors across the board

The functionality of most of the supported websites not mentioned above has not been checked so there might be things in need of fixing that aren't fixed yet.

## Supported sites

Scraping is provided by [neo-scraper](https://github.com/simpleblackshirt/neo-scraper); see its [supported sites table](https://github.com/simpleblackshirt/neo-scraper#supported-sites) for the full site/feature list (22 engines plus a fallback that grabs the largest image or video on the page).

## Installation

### Firefox

Download the signed .xpi from the [release tab](./releases) and install it manually (about:addons → gear icon → "Install Add-on From File..."). Builds are signed on the unlisted channel and do not update automatically.

### Chrome

Download the .zip from the [release tab](./releases) and load it via [Chrome's "Load unpacked extension"](https://developer.chrome.com/docs/extensions/mv3/getstarted/#unpacked). Check [this Stack Overflow answer](https://stackoverflow.com/a/38011386) if you want to get rid of the developer extension popup.

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

### Local neo-scraper development

`neo-scraper` is installed from GitHub (`github:simpleblackshirt/neo-scraper#master`) and pinned by commit in `pnpm-lock.yaml`; bump it with `pnpm update neo-scraper`. To develop against a local checkout:

```sh
pnpm link ../neo-scraper   # node_modules/neo-scraper now points at the sibling checkout
pnpm build                 # embeds your local dist (keep it fresh: pnpm build / pnpm watch in neo-scraper)
pnpm unlink neo-scraper    # before committing anything here
```

While linked, pnpm records an `overrides` entry in `pnpm-workspace.yaml`/`pnpm-lock.yaml` which must never be committed — the pre-commit hook blocks such commits (bypass with `--no-verify` if ever truly intended). Hooks are not active on fresh clones; activate them with:

```sh
git config core.hooksPath .githooks
```

### Dev notes (MV3)

`pnpm dev` runs three things at once: manifest/HTML preparation, a Vite dev server on `http://localhost:3303` serving popup and options, and parallel watch builds for content script + background. Pair it with `pnpm start:chromium` / `pnpm start:firefox` (web-ext) to auto-reload the extension on rebuilds.

- **Popup / options** hot-swap via dev-server HMR (Firefox needs a temporary add-on load and 147+ for it).
- **Background** has no HMR: an MV3 background cannot load its script from the dev server, so it's a plain rebuilt file — reload via web-ext or manually.
- **Content scripts** are rebuilt on change and reinjected into every page on navigation by a dev-only hook (`src/background/contentScriptHMR.ts`), so a page reload picks them up.

For the background's referer/runtime design (DNR session rules on Chromium vs. blocking webRequest on Firefox), see `docs/plan/20261015-mv3-migration/t3-mv3-background-runtime.md`.

See [the developer notes](https://github.com/neobooru/SzuruChrome/wiki/Developer-notes) for more information.
