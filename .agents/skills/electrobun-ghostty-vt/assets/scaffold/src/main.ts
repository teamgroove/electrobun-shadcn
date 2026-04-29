import { BrowserWindow, BrowserView } from "electrobun/bun";
import { loadGhostty, Terminal } from "./terminal";
import type { TerminalRPC } from "./rpc";

const WASM_PATH =
  import.meta.dir + "/../vendors/ghostty-vt.wasm";

const ghostty = await loadGhostty(WASM_PATH);
const term = new Terminal(ghostty, 80, 24);

const terminalRPC = BrowserView.defineRPC<TerminalRPC>({
  handlers: {
    requests: {
      writeVT: async ({ data }) => {
        term.write(data);
        broadcastScreen();
      },
      getScreen: async ({ format }) => {
        return format === "html" ? term.toHTML() : term.toPlainText();
      },
    },
    messages: {},
  },
});

function broadcastScreen() {
  const plain = term.toPlainText();
  mainWindow.webview.rpc?.send.screenUpdated({ screen: plain, format: "plain" });
}

const mainWindow = new BrowserWindow({
  title: "Ghostty Terminal",
  url: "views://main/index.html",
  frame: {
    width: 900,
    height: 600,
  },
  rpc: terminalRPC,
});

// Optional: demo content on startup
term.write("\x1b[1;32mHello from Ghostty + Electrobun!\x1b[0m\r\n");
term.write("\x1b[33mType VT sequences below or use the input field.\x1b[0m\r\n\r\n");
broadcastScreen();
