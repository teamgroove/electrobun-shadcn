import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Ghostty Terminal",
    identifier: "com.example.ghostty-terminal",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/main.ts",
    },
    views: {
      main: {
        entrypoint: "src/webview/main.tsx",
        minify: true,
      },
    },
    copy: {
      "src/webview/index.html": "views/main/index.html",
      "src/webview/styles.css": "views/main/styles.css",
      "vendors/ghostty-vt.wasm": "views/main/ghostty-vt.wasm",
    },
  },
} satisfies ElectrobunConfig;
