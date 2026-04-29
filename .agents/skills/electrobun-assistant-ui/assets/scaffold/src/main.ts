import { BrowserWindow, BrowserView } from "electrobun/bun";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ChatRPC } from "./rpc";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const chatRPC = BrowserView.defineRPC<ChatRPC>({
  handlers: {
    requests: {
      sendMessage: async ({ messages }) => {
        const messageId = crypto.randomUUID();
        const webview = mainWindow.webview;

        const result = streamText({
          model: openai("gpt-4o-mini"),
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        (async () => {
          try {
            for await (const text of result.textStream) {
              webview.rpc?.send.chatChunk({ messageId, text });
            }
            webview.rpc?.send.chatDone({ messageId });
          } catch (err: any) {
            webview.rpc?.send.chatError({
              messageId,
              error: err.message ?? "Stream failed",
            });
          }
        })();

        return { messageId };
      },
    },
    messages: {},
  },
});

const mainWindow = new BrowserWindow({
  title: "AI Chat",
  url: "views://main/index.html",
  frame: {
    width: 900,
    height: 700,
  },
  rpc: chatRPC,
});
