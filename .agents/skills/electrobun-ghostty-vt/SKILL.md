---
name: electrobun-ghostty-vt
description: Embed the Ghostty terminal emulator (libghostty-vt) inside Electrobun desktop apps via WebAssembly. Use when building terminal emulators, VT sequence parsers, or ANSI-rendered output viewers in Electrobun, running ghostty-vt.wasm in the Bun main process, bridging terminal state to a webview UI, or needing cross-platform terminal emulation without native binaries.
---

# Electrobun + Ghostty VT

Run the Ghostty terminal emulator as a WASM module inside Electrobun's Bun main process. Render the terminal screen in a webview, pipe shell output through it, or use it as a VT sequence parser.

## Quick Start

```bash
cp -r <skill-path>/assets/scaffold ./my-terminal-app
cd my-terminal-app

# Build or download ghostty-vt.wasm into vendors/
# See Building the WASM module below

bun install
bun dev
```

## Architecture

```
User Input ──► Webview ──► RPC ──► Bun Main Proc
                                       │
                                       ▼
                                 ┌─────────────┐
                                 │ ghostty-vt  │
                                 │  .wasm      │
                                 │  (WASM)     │
                                 └─────────────┘
                                       │
                                       ▼
Screen Data ◄── RPC ◄── Formatted Text (plain / HTML)
```

The WASM module lives in the **main process**, not the webview. This avoids shipping the ~300–800 KB binary to the renderer and keeps terminal logic next to any shell PTYs or external processes you spawn.

## Building the WASM Module

Ghostty has a first-class WASM build target:

```bash
git clone https://github.com/ghostty-org/ghostty.git
cd ghostty
zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
# outputs zig-out/bin/ghostty-vt.wasm
```

Copy `ghostty-vt.wasm` into the scaffold's `vendors/` directory. Electrobun's config copies it into the app bundle at build time.

**No Zig toolchain on the target machine:** Build the `.wasm` once, commit it, and it runs on Windows, macOS, and Linux without recompilation.

## TypeScript Wrapper API

The bundled `src/terminal.ts` auto-discovers C struct layouts via `ghostty_type_json()` so you never write bindings by hand.

### Load the module

```ts
import { loadGhostty, Terminal } from "./terminal";

const ghostty = await loadGhostty("./vendors/ghostty-vt.wasm");
const term = new Terminal(ghostty, 80, 24);
```

### Write VT data

```ts
term.write("\x1b[1;32mHello World\x1b[0m\r\n");
```

### Read formatted output

```ts
const plain = term.toPlainText();
const html  = term.toHTML();
```

### Cleanup

```ts
term.free();
```

## Wiring into Electrobun

The scaffold demonstrates a complete integration:

- **`src/main.ts`** — Loads WASM, creates a `Terminal`, exposes RPC handlers (`writeVT`, `getScreen`)
- **`src/webview/electrobun.ts`** — Defines RPC handlers for `screenUpdated` messages
- **`src/webview/components/Terminal.tsx`** — React component that renders screen text and sends input back to Bun

Key RPC pattern: after every `writeVT`, the main process formats the screen and broadcasts a `screenUpdated` message to the webview.

## Extending: Real Shell Integration

To turn the demo into a real terminal emulator, spawn a PTY in the main process:

```ts
import { spawn } from "bun";

const pty = spawn({
  cmd: ["bash"], // or cmd.exe on Windows via conpty
  stdout: "pipe",
  stdin: "pipe",
});

// Pipe shell stdout into ghostty
pty.stdout.pipeTo(
  new WritableStream({
    write(chunk) {
      term.write(chunk);
      broadcastScreen();
    },
  })
);

// Pipe webview keystrokes into shell stdin
rpc.handlers.requests.sendKey = async ({ key }) => {
  pty.stdin.write(key);
};
```

For Windows PTYs, use the `node-pty` equivalent or Windows ConPTY APIs. The skill keeps the ghostty VT rendering layer separate from the PTY layer so either can be swapped.

## Advanced Patterns

For details on the C API, custom struct access, formatter options, and memory management, see [references/wasm-bindings.md](references/wasm-bindings.md).
