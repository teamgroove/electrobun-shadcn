import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import type { ChatMessage } from "../rpc";
import { electrobun } from "./electrobun";
import { createQueue, removeQueue } from "./lib/stream-queue";
import { Chat } from "./components/Chat";

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const converted: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join(""),
    }));

    const { messageId } = await electrobun.rpc!.request.sendMessage({
      messages: converted,
    });

    const queue = createQueue(messageId);

    try {
      yield* queue.generator();
    } finally {
      removeQueue(messageId);
      if (abortSignal?.aborted) {
        // Optionally notify main process to abort the stream
      }
    }
  },
};

function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useLocalRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

export function App() {
  return (
    <RuntimeProvider>
      <Chat />
    </RuntimeProvider>
  );
}
