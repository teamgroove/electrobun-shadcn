# Advanced RPC Patterns

## Table of Contents

- [Tool Calling](#tool-calling)
- [Abort / Cancellation](#abort--cancellation)
- [Multi-Window Setup](#multi-window-setup)
- [Message Persistence](#message-persistence)
- [Error Handling](#error-handling)
- [Common Gotchas](#common-gotchas)

---

## Tool Calling

To support assistant-ui tool calling with the main-process architecture:

1. **Main process**: Use Vercel AI SDK `streamText` with `tools` option
2. **Stream handling**: Tool call deltas stream as text chunks. The Vercel AI SDK handles this automatically via `textStream`.
3. **Results**: If tools execute on the main process, collect results and stream them back as follow-up messages, or use assistant-ui's frontend tool execution.

For frontend tool execution (tools run in webview):
- Define tools in the webview using `useAssistantTool`
- Pass `toToolsJSONSchema(tools)` to the main process via RPC
- Main process includes `tools` in `streamText`
- Tool call requests stream back as chunks; assistant-ui renders them and calls the webview tool handlers

## Abort / Cancellation

Electrobun RPC requests cannot be trivially aborted mid-flight. Patterns:

**Option A: Ignore late chunks**
- Webview sets a flag on abort
- Incoming `chatChunk` messages for that `messageId` are dropped if aborted
- Main process continues streaming but webview ignores it

**Option B: Abort in main process**
- Add an `abortMessage` RPC request
- Store `AbortController` per active message in main process
- Call `controller.abort()` when webview requests abort
- Catch abort errors and send `chatError` or `chatDone`

## Multi-Window Setup

If you have multiple webviews that need chat access:

1. Define the RPC schema once and reuse it with `BrowserView.defineRPC`
2. Each `BrowserWindow` gets its own RPC instance
3. Store active streams in a `Map<windowId, StreamState>` in the main process
4. Route messages to the correct window's `webview.rpc?.send.*`

## Message Persistence

To persist chat history across app restarts:

1. Add a `loadHistory` RPC request
2. Main process reads from SQLite / JSON file / Convex
3. Returns messages to webview on startup
4. Webview passes them as initial state to `useLocalRuntime` or `useRemoteThreadListRuntime`

For simple persistence, override the `history` adapter in `useLocalRuntime` options.

## Error Handling

Always wrap the stream loop in try/catch in the main process:

```ts
(async () => {
  try {
    for await (const text of result.textStream) {
      webview.rpc?.send.chatChunk({ messageId, text });
    }
    webview.rpc?.send.chatDone({ messageId });
  } catch (err: any) {
    webview.rpc?.send.chatError({ messageId, error: err.message });
  }
})();
```

In the webview, the `StreamQueue` throws on `chatError`, which propagates through the async generator and surfaces in assistant-ui as a failed run.

## Common Gotchas

- **Message IDs**: Always generate a unique `messageId` per stream. The webview queue routes by ID.
- **Async generators**: The `run` method must be `async *generator`. Returning a plain array disables streaming.
- **RPC init timing**: `electrobun.rpc` may be null briefly on startup. The template handles this; for custom code, add a retry or wait for `dom-ready`.
- **Tailwind v4**: The scaffold uses Tailwind v4 (`@import "tailwindcss"`). If you prefer v3, update the import and config file accordingly.
- **Model adapters**: assistant-ui expects `ChatModelAdapter` with `run` yielding `ChatModelRunResult`. Do not return `response.json()` or a full string — yield chunks.
