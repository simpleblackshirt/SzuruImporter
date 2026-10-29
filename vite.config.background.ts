import { defineConfig } from "vite";
import { sharedConfig } from "./vite.config.ts";
import { isDev, r } from "./scripts/utils.ts";
import packageJson from "./package.json" with { type: "json" };

// MV3 background bundle: must be ONE self-contained classic script because the dual
// {scripts, service_worker} manifest pattern (src/manifest.ts) loads the same file as a
// Firefox event-page classic script and a Chromium service worker - neither form resolves
// ES module imports (see README "Development & hot reload"). Same single-file IIFE pattern
// as vite.config.content.ts.
export default defineConfig({
  ...sharedConfig,
  define: {
    __DEV__: isDev,
    // https://github.com/vitejs/vite/issues/9320
    // https://github.com/vitejs/vite/issues/9186
    "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
  },
  build: {
    watch: isDev ? {} : undefined,
    outDir: r("extension/dist/background"),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? "inline" : false,
    lib: {
      entry: r("src/background/main.ts"),
      name: packageJson.name,
      formats: ["iife"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        extend: true,
      },
    },
  },
});
