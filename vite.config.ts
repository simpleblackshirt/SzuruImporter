/// <reference types="vitest" />

import { dirname, relative } from "path";
import type { UserConfig } from "vite";
import { defineConfig } from "vite";
import Vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { isDev, port, r } from "./scripts/utils.ts";

export const sharedConfig: UserConfig = {
  root: r("src"),
  resolve: {
    alias: {
      "~/": `${r("src")}/`,
    },
  },
  define: {
    __DEV__: isDev,
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Silence deprecation warnings from dependencies (primeflex still uses
        // deprecated @import/global built-ins); our own SCSS keeps its warnings.
        quietDeps: true,
      },
    },
  },
  plugins: [
    Vue(),

    AutoImport({
      imports: [
        "vue",
        {
          "webextension-polyfill": [["*", "browser"]],
        },
      ],
      dts: r("src/auto-imports.d.ts"),
    }),

    Components({
      dirs: [r("src/components")],
      // generate `components.d.ts` for ts support with Volar
      dts: r("src/components.d.ts"),
      resolvers: [
        // auto import icons
        // IconsResolver({
        //   componentPrefix: "",
        // }),
      ],
    }),

    // rewrite assets to use relative path
    {
      name: "assets-rewrite",
      enforce: "post",
      apply: "build",
      transformIndexHtml(html, { path }) {
        return html.replace(/"\/assets\//g, `"${relative(dirname(path), "/assets")}/`);
      },
    },
  ],
  optimizeDeps: {
    include: ["vue", "@vueuse/core", "webextension-polyfill"],
  },
};

export default defineConfig(({ command }) => ({
  ...sharedConfig,
  base: command === "serve" ? `http://localhost:${port}/` : "/dist/",
  server: {
    port,
    // The extension's dev stubs (scripts/prepare.ts) hardcode this port: a
    // silent bump to 3304 would leave the popup loading stale code from
    // whatever occupies 3303. Fail loudly instead.
    strictPort: true,
    hmr: {
      host: "localhost",
    },
  },
  build: {
    outDir: r("extension/dist"),
    emptyOutDir: false,
    sourcemap: isDev ? "inline" : false,
    rollupOptions: {
      input: {
        // Background is not an HTML entry: it is built separately as a single-file
        // classic script by vite.config.background.ts (see src/manifest.ts).
        options: r("src/options/index.html"),
        popup: r("src/popup/index.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    pool: "threads",
    hookTimeout: 60000,
    clearMocks: false,
    mockReset: false,
    restoreMocks: false,
  },
}));
