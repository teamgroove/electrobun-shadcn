import type { RPCSchema } from "electrobun";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ChatRPC = {
  bun: RPCSchema<{
    requests: {
      sendMessage: {
        params: { messages: ChatMessage[] };
        response: { messageId: string };
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      chatChunk: {
        messageId: string;
        text: string;
      };
      chatDone: {
        messageId: string;
      };
      chatError: {
        messageId: string;
        error: string;
      };
    };
  }>;
};
