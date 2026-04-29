# Browser Automation with Electrobun Webviews

Use Electrobun's native `BrowserWindow`/`BrowserView` APIs to drive web pages directly — no Puppeteer, Playwright, or bunwv required. The main process controls the webview, injects JavaScript, and receives events.

## Architecture

```
Bun Main Process                          Webview
├─ BrowserWindow with RPC ─────────────►  ├─ loads target URL
├─ webview.executeJavascript() ───────►  ├─ runs injected scripts
├─ webview.on("did-navigate", ...)  ◄───  └─ emits navigation events
└─ Extracted data returned via RPC  ◄───
```

## Core APIs

| Method | Purpose |
|--------|---------|
| `webview.loadURL(url)` | Navigate to a page |
| `webview.executeJavascript(js)` | Run JS in the page context |
| `webview.goBack()` / `goForward()` / `reload()` | History navigation |
| `webview.setNavigationRules(rules)` | Block/allow URLs |
| `webview.on("dom-ready", handler)` | Detect page load |
| `webview.on("did-navigate", handler)` | Detect navigation |
| `webview.findInPage(text)` | Find text in page |
| `webview.setPageZoom(level)` | Adjust zoom |

## Minimal Automation Controller

```ts
// src/automation.ts
import { BrowserWindow } from "electrobun/bun";

export class WebAutomation {
  private win: BrowserWindow;

  constructor(url: string) {
    this.win = new BrowserWindow({
      title: "Automation",
      url,
      frame: { width: 1280, height: 800 },
      // sandbox: true for untrusted content (disables RPC)
    });
  }

  async waitForNavigation(timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Navigation timeout")), timeout);
      this.win.webview.on("did-navigate", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async waitForDOMReady(timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DOM ready timeout")), timeout);
      this.win.webview.on("dom-ready", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    // Electrobun does not return evaluate results directly.
    // Inject a script that posts data back via RPC or a global callback.
    const wrapped = `
      (async () => {
        const result = await (async () => { ${script} })();
        window.__automationResult = result;
      })();
    `;
    this.win.webview.executeJavascript(wrapped);
    // Then poll for window.__automationResult or use RPC
    return null as T; // see two-way pattern below
  }

  navigate(url: string) {
    this.win.webview.loadURL(url);
  }

  click(selector: string) {
    this.win.webview.executeJavascript(`
      document.querySelector('${selector}')?.click();
    `);
  }

  type(selector: string, text: string) {
    this.win.webview.executeJavascript(`
      const el = document.querySelector('${selector}');
      if (el) {
        el.focus();
        el.value = '${text.replace(/'/g, "\\'")}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
  }

  screenshot(): Promise<Uint8Array> {
    // See Screenshot Strategies below
    throw new Error("Not implemented — see reference for strategies");
  }

  close() {
    this.win.webview.remove();
  }
}
```

## Two-Way Data Extraction Pattern

Since `executeJavascript` does not return values directly, use a preload script or RPC to send data back to Bun.

**Option A: Preload script (trusted content)**

```ts
// src/main.ts
const preloadScript = `
  window.__bunAutomation = {
    send: (data) => window.__electrobun?.sendMessageToBun?.({
      type: 'automation-data',
      payload: data
    })
  };
`;

const win = new BrowserWindow({
  url: "https://example.com",
  preload: preloadScript,
  rpc: myRPC,
});
```

Then in the page:
```js
// Injected via executeJavascript
const data = document.title;
window.__bunAutomation.send({ type: 'title', data });
```

**Option B: Global polling (sandboxed / untrusted)**

```ts
async function evaluateAndPoll(script: string, timeout = 5000): Promise<unknown> {
  const key = `__automation_${Date.now()}`;
  win.webview.executeJavascript(`
    (async () => {
      try {
        window.${key} = { done: true, result: await (async () => { ${script} })() };
      } catch (e) {
        window.${key} = { done: true, error: e.message };
      }
    })();
  `);

  const start = Date.now();
  while (Date.now() - start < timeout) {
    // We cannot read JS globals directly from Bun, so this pattern
    // requires an RPC bridge. Use Option A for real two-way comms.
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Poll timeout");
}
```

**Option C: RPC bridge (recommended)**

Define an RPC schema where the webview can call `reportData` and Bun handles it:

```ts
// rpc.ts
export type AutomationRPC = {
  bun: RPCSchema<{ requests: {}; messages: {} }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      reportData: { key: string; value: unknown };
    };
  }>;
};

// main.ts
const rpc = BrowserView.defineRPC<AutomationRPC>({
  handlers: {
    messages: {
      reportData: ({ key, value }) => {
        automationResults.set(key, value);
      },
    },
  },
});
```

Then inject:
```ts
win.webview.executeJavascript(`
  electrobun.rpc?.send.reportData({
    key: 'title',
    value: document.title
  });
`);
```

## Simulating User Actions

All interactions go through `executeJavascript`:

```ts
// Click
webview.executeJavascript(`document.querySelector('button.submit').click();`);

// Type (React-friendly)
webview.executeJavascript(`
  const el = document.querySelector('input[name="email"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'user@example.com');
  el.dispatchEvent(new Event('input', { bubbles: true }));
`);

// Scroll
webview.executeJavascript(`window.scrollBy(0, 500);`);

// Press key
webview.executeJavascript(`
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
`);

// Wait for element (poll from Bun side)
async function waitForSelector(selector: string, timeout = 10000) {
  // Inject a marker that sets a global when found
  const marker = `__found_${Date.now()}`;
  webview.executeJavascript(`
    const check = () => {
      if (document.querySelector('${selector}')) {
        window.${marker} = true;
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  `);
  // Poll via RPC or event until marker appears
}
```

## Screenshot Strategies

Electrobun does not expose a native `captureScreenshot` API yet. Options:

### 1. Chrome DevTools Protocol (CEF backend only)

If using the CEF renderer (`renderer: "cef"`), connect to Chrome's remote debugging protocol:

```ts
// Launch CEF with remote debugging enabled via chromeArgv in config
// Then connect to ws://localhost:9222 and call Page.captureScreenshot
```

This requires electrobun config support for `chromeArgv`.

### 2. html2canvas via JS Injection

Inject `html2canvas` or a similar DOM-to-canvas library into the page, then extract the canvas as base64:

```ts
webview.executeJavascript(`
  import('https://html2canvas.hertzen.com/dist/html2canvas.min.js').then(h2c => {
    h2c(document.body).then(canvas => {
      const base64 = canvas.toDataURL('image/png');
      window.__screenshot = base64;
      // Send back to Bun via RPC
    });
  });
`);
```

### 3. External Capture Tool

Use platform-specific tools (not webview-native):
- **macOS**: `screencapture -l <windowId>`
- **Windows**: `nircmd` or Win32 APIs
- **Linux**: `import` (ImageMagick) or `grim`

### 4. Headless Chrome Spawn (if CEF is insufficient)

For heavy scraping, spawn a separate headless Chrome process and control it via CDP, keeping electrobun as the UI layer.

## Multi-Session Automation

Run multiple isolated webviews simultaneously:

```ts
const sessions = new Map<string, BrowserWindow>();

function createSession(name: string, url: string) {
  const win = new BrowserWindow({
    title: `Session: ${name}`,
    url,
    frame: { width: 1280, height: 800, x: 100, y: 100 },
  });
  sessions.set(name, win);
  return win;
}

// Run tasks in parallel
await Promise.all([
  scrapeProductPage(sessions.get("amazon")!),
  scrapeProductPage(sessions.get("ebay")!),
]);
```

## Navigation Rules

Block unwanted navigation (ads, popups) during automation:

```ts
webview.setNavigationRules([
  "allow:*://target-site.com/*",
  "block:*",
]);
```

Rules are JSON arrays of `allow:` or `block:` patterns matched against URLs.

## Event Reference

| Event | When it fires |
|-------|---------------|
| `will-navigate` | Before navigating to a new URL (can cancel) |
| `did-navigate` | After main frame navigation completes |
| `did-navigate-in-page` | Hash/fragment navigation |
| `did-commit-navigation` | Navigation committed (content loaded) |
| `dom-ready` | DOM is ready (equivalent to DOMContentLoaded) |
| `new-window-open` | Page tries to open a popup |
| `download-started` | File download begins |

## Complete Example: Scraping Pipeline

```ts
// src/scraper.ts
import { BrowserWindow } from "electrobun/bun";

export async function scrapePrice(url: string): Promise<string | null> {
  const win = new BrowserWindow({
    title: "Scraper",
    url,
    frame: { width: 1280, height: 800 },
    hidden: true, // run headless-ish (window not visible)
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 15000);
    win.webview.on("dom-ready", () => { clearTimeout(t); resolve(); });
  });

  // Inject data extractor
  win.webview.executeJavascript(`
    const price = document.querySelector('.price')?.textContent?.trim();
    window.__extractedPrice = price || null;
  `);

  // For real use, send back via RPC. Here we simulate a delay.
  await new Promise(r => setTimeout(r, 500));

  win.webview.remove();

  // In practice, get the value from your RPC handler
  return null; // placeholder
}
```

## Security Notes

- **Sandbox mode**: Set `sandbox: true` on `BrowserWindow` when loading untrusted URLs. This disables RPC and prevents the page from communicating with Bun.
- **Navigation rules**: Always restrict where automated webviews can navigate.
- **Isolate sessions**: Use separate `BrowserWindow`s with different partitions to isolate cookies/storage.
- **Never eval user input**: Sanitize any strings passed to `executeJavascript` to prevent injection into the main process context.
