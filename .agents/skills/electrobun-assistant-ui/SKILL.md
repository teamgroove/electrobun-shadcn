---
name: electrobun-assistant-ui
description: Build desktop AI chat applications with assistant-ui rendered inside Electrobun webviews, using the Vercel AI SDK in the Bun main process. Use when scaffolding or developing Electrobun desktop apps that need AI chat UIs, integrating assistant-ui with Electrobun's RPC system, streaming LLM responses from the main process to a webview, or setting up Vercel AI SDK (OpenAI, Anthropic, etc.) inside an Electrobun app.
---

# Electrobun + assistant-ui

Build tiny, fast desktop AI chat apps. Architecture: **Bun main process holds API keys and streams LLM responses via Electrobun RPC to a webview running assistant-ui.**

## Quick Start

Scaffold a new project from the bundled template:

```bash
cp -r <skill-path>/assets/scaffold ./my-ai-chat-app
cd my-ai-chat-app
bun install
cp .env.example .env
# Add your OPENAI_API_KEY to .env
bun dev
```

The template includes:
- Electrobun main process with Vercel AI SDK `streamText`
- Typed RPC between main process and webview
- assistant-ui `LocalRuntime` with a custom `ChatModelAdapter`
- Streaming bridge: main process sends chunks as RPC messages; webview adapter yields them via an async generator
- Minimal Tailwind-styled chat UI using assistant-ui primitives

## Architecture

```
┌─────────────────┐      RPC (typed)       ┌────────────────────┐
│  Bun Main Proc  │ ◄────────────────────► │  Webview (React)   │
│                 │   sendMessage request  │                    │
│  • API keys     │                        │  • assistant-ui    │
│  • streamText   │   chatChunk messages   │  • LocalRuntime    │
│  • fs / os APIs │  ───────────────────►  │  • Custom Adapter  │
└─────────────────┘                        └────────────────────┘
```

**Why main process = AI gateway:**
- API keys never touch the webview
- Direct access to filesystem, OS APIs, local models
- Smaller webview bundle

## Key Patterns

### 1. RPC Schema (shared types)

Define once in `src/rpc.ts`. Use `RPCSchema` from `"electrobun"`.

```ts
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
      chatChunk: { messageId: string; text: string };
      chatDone: { messageId: string };
      chatError: { messageId: string; error: string };
    };
  }>;
};
```

### 2. Main Process Streaming

In `src/main.ts`:

```ts
const chatRPC = BrowserView.defineRPC<ChatRPC>({
  handlers: {
    requests: {
      sendMessage: async ({ messages }) => {
        const messageId = crypto.randomUUID();
        const result = streamText({ model: openai("gpt-4o"), messages });

        (async () => {
          for await (const text of result.textStream) {
            mainWindow.webview.rpc?.send.chatChunk({ messageId, text });
          }
          mainWindow.webview.rpc?.send.chatDone({ messageId });
        })();

        return { messageId };
      },
    },
    messages: {},
  },
});
```

### 3. Webview Async Generator Bridge

Electrobun RPC is message-based, not a stream. Bridge it with a queue:

```ts
// In the ChatModelAdapter
async *run({ messages, abortSignal }) {
  const { messageId } = await electrobun.rpc!.request.sendMessage({ messages });
  const queue = createQueue(messageId); // StreamQueue per messageId

  try {
    yield* queue.generator(); // Yields ChatModelRunResult as chunks arrive
  } finally {
    removeQueue(messageId);
  }
}
```

The `StreamQueue` class (see template `src/webview/lib/stream-queue.ts`) buffers incoming RPC `chatChunk` messages and yields them through an async generator that assistant-ui consumes.

### 4. Webview RPC Handlers

Register message handlers in `src/webview/electrobun.ts`:

```ts
const rpc = Electroview.defineRPC<ChatRPC>({
  handlers: {
    messages: {
      chatChunk: ({ messageId, text }) => getQueue(messageId)?.push(text),
      chatDone: ({ messageId }) => getQueue(messageId)?.finish(),
      chatError: ({ messageId, error }) => getQueue(messageId)?.fail(error),
    },
  },
});
```

## Swapping AI Providers

The template uses `@ai-sdk/openai`. To switch providers:

1. `bun add @ai-sdk/anthropic` (or other provider)
2. In `src/main.ts`, replace `createOpenAI` with `createAnthropic` and update the model name
3. Ensure the corresponding API key env var is set

No webview changes are required.

## Adding Native Features

Because the AI backend lives in the Bun main process, you can extend `sendMessage` to:
- Read local files and include them in the context
- Execute shell commands and stream output
- Access OS APIs (clipboard, notifications, tray) before/after LLM calls

Extend the RPC schema with new requests and messages as needed.

## Security Layer

To add a local prompt-injection firewall (e.g., `hlyn/prompt-injection-judge-deberta-70m`) that gates user input, MCP tool results, and external data before they reach the LLM or webview, see [references/security-layer.md](references/security-layer.md). The main process is the ideal place for this because it intercepts all traffic.

## Browser Automation

Electrobun's native webviews can drive pages directly without Puppeteer, Playwright, or bunwv. See [references/browser-automation.md](references/browser-automation.md) for navigation, JS injection, data extraction, multi-session scraping, and screenshot strategies.

## Advanced Patterns

For detailed patterns including tool calling, abort handling, multi-window setup, and message persistence, see [references/rpc-patterns.md](references/rpc-patterns.md).
