# Electrobun Starter

An opinionated starter template for building desktop applications with [Electrobun](https://electrobun.dev/).

**Note:** Electrobun is NOT Electron. Do not use Electron APIs or patterns. See the [Electrobun docs](https://blackboard.sh/electrobun/docs/) for API reference.

## Create a New Project

**Option A — GitHub template** (requires the repo to be marked as a template in Settings):

```bash
gh repo create my-app --template mattgi/electrobun-starter --clone
cd my-app
bun run scripts/init.ts myapp
bun install
```

**Option B — degit** (no git history):

```bash
bunx degit mattgi/electrobun-starter my-app
cd my-app
bun run scripts/init.ts myapp
bun install
```

The init script renames `product` to your app name across all config files. Pass `--identifier` to customize the bundle ID:

```bash
bun run scripts/init.ts myapp --identifier com.mycompany.myapp
```

## What's Included

- **React 19** with TypeScript for the webview UI
- **Vite 6** for fast development builds with HMR support
- **Tailwind CSS 4** for styling
- **shadcn/ui** pre-configured (New York style, neutral base)
- **Biome** for linting and formatting
- **Type-safe RPC** between main process and webview via shared schema
- **Bun** as the runtime and package manager

## Project Structure

```
src/
  bun/            # Main process (Bun runtime)
    index.ts      # App entry point, window creation, RPC handlers, menu
  mainview/       # Webview UI (React + Vite)
    components/   # React components (including shadcn/ui)
    lib/          # Utilities (cn(), electrobun RPC client)
    index.html    # HTML entry point
    index.tsx     # React root
    index.css     # Tailwind + theme tokens
shared/           # Shared types between main and webview
  rpc.ts          # RPC schema definition (type-safe contract)
```

## Development

### Quick start

```bash
bun install
bun run start        # Build webview + launch app (one-shot)
```

### Development with file watching

```bash
bun run dev          # Electrobun watches source files, rebuilds + relaunches on change
```

### Development with Hot Module Replacement

```bash
bun run dev:hmr      # Runs Vite dev server (port 5173) + Electrobun concurrently
```

The main process probes `localhost:5173` at startup. If the Vite dev server is running, it loads from there instead of the bundled `views://` assets. This gives you instant HMR for the webview UI without rebuilding the whole app.

### Linting

```bash
bun run lint         # Check with Biome
bun run lint:fix     # Auto-fix
```

## Adding UI Components

This project uses [shadcn/ui](https://ui.shadcn.com/) with the New York style. To add components:

```bash
bunx shadcn@latest add button
bunx shadcn@latest add dialog
```

Components are placed in `src/mainview/components/ui/`. The `cn()` utility is at `src/mainview/lib/utils.ts`.

## RPC (Main <-> Webview Communication)

The type-safe RPC contract lives in `shared/rpc.ts`. Both sides import from it:

- **Main process** (`src/bun/index.ts`): `BrowserView.defineRPC<MainRPC>()` — defines request handlers and message listeners
- **Webview** (`src/mainview/lib/electrobun.ts`): `Electroview.defineRPC<MainRPC>()` — calls requests and sends messages

To add a new RPC method:

1. Add the type to `shared/rpc.ts` under `bun.requests` or `bun.messages`
2. Implement the handler in `src/bun/index.ts`
3. Call it from the webview via `electrobun.rpc.request("methodName", params)`

## Building & Releasing

Electrobun uses `--env` to distinguish build channels:

| Channel | Command | Purpose |
|---|---|---|
| `dev` | `bun run start` | Local development build, launches immediately |
| `canary` | `bun run build:canary` | Pre-release testing build |
| `stable` | `bun run build:stable` | Production release build |

All build scripts run `vite build` first, then `electrobun build`. The `copy` rules in `electrobun.config.ts` map Vite output into the app bundle:

```
dist/index.html   → views/mainview/index.html
dist/assets/      → views/mainview/assets/
```

### Release & updates

Electrobun has a built-in delta update system. Configure the release URL in `electrobun.config.ts`:

```ts
release: {
  baseUrl: "https://your-cdn.com/releases/",
}
```

Then build a stable release:

```bash
bun run build:stable
```

This generates the app bundle plus patch files for delta updates. Upload the build output to your `baseUrl` location. The app can check for and apply updates at runtime using the `Updater` API from `electrobun/bun`.

### macOS code signing and notarization

In `electrobun.config.ts`, set:

```ts
mac: {
  codesign: true,
  notarize: true,
  entitlements: { /* ... */ },
}
```

See the [Electrobun docs](https://blackboard.sh/electrobun/docs/) for details on certificates and notarization setup.

### Cross-platform

The config includes `mac`, `linux`, and `win` blocks. Set `bundleCEF: true` on each platform to include the Chromium Embedded Framework in the app bundle for distribution (set to `false` during development to save build time).

## Key Config Files

| File | Purpose |
|---|---|
| `electrobun.config.ts` | App metadata, build settings, platform config, copy rules, release URL |
| `vite.config.ts` | Vite build config, dev server port, path aliases |
| `tsconfig.json` | TypeScript config covering both `src/` and `shared/` |
| `components.json` | shadcn/ui CLI configuration |
| `biome.json` | Linting and formatting rules |
| `postcss.config.mjs` | PostCSS with Tailwind CSS 4 plugin |
