import type { RPCSchema } from "electrobun";

export type TerminalRPC = {
  bun: RPCSchema<{
    requests: {
      writeVT: {
        params: { data: string };
        response: void;
      };
      getScreen: {
        params: { format?: "plain" | "html" };
        response: string;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      screenUpdated: {
        screen: string;
        format: "plain" | "html";
      };
    };
  }>;
};
