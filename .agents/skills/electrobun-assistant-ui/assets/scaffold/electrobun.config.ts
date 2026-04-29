import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "AI Chat",
    identifier: "com.example.ai-chat",
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
    },
  },
} satisfies ElectrobunConfig;
