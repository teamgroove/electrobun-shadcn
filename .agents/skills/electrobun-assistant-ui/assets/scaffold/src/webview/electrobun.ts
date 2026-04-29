import Electrobun, { Electroview } from "electrobun/view";
import type { ChatRPC } from "../rpc";
import { getQueue } from "./lib/stream-queue";

const rpc = Electroview.defineRPC<ChatRPC>({
  maxRequestTime: 300000,
  handlers: {
    requests: {},
    messages: {
      chatChunk: ({ messageId, text }) => {
        getQueue(messageId)?.push(text);
      },
      chatDone: ({ messageId }) => {
        getQueue(messageId)?.finish();
      },
      chatError: ({ messageId, error }) => {
        getQueue(messageId)?.fail(error);
      },
    },
  },
});

export const electrobun = new Electrobun.Electroview({ rpc });
