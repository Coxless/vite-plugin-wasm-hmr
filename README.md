# vite-plugin-wasm-hmr

Vite plugin that watches Rust source files, rebuilds with wasm-pack, and triggers HMR — all within the Vite dev server. No separate watcher process, no sentinel files.

## Install

```bash
npm install -D vite-plugin-wasm-hmr
```

You also need [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and [vite-plugin-wasm](https://github.com/nicolo-ribaudo/vite-plugin-wasm):

```bash
npm install -D vite-plugin-wasm
cargo install wasm-pack
```

## Quick Start

### 1. vite.config.ts

```ts
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { wasmHmr } from "vite-plugin-wasm-hmr";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    wasmHmr({ crate: "../wasm" }), // path to your Rust crate
  ],
});
```

`crate` is the only required option. The package name is auto-detected from `pkg/package.json`.

### 2. Use WASM in your code

Just import. HMR works automatically:

```ts
import { greet } from "my-wasm-pkg";

greet("world");
```

### 3. Run dev server

```bash
npx vite
```

That's it. Edit your `.rs` files and see changes reflected in the browser without a full reload.

## How It Works

```
*.rs or Cargo.toml saved
  -> Node.js fs.watch() detects change
  -> Debounce (300ms)
  -> wasm-pack build --target bundler --dev -> pkg-staging/
  -> Copy pkg-staging/ -> pkg/
  -> Invalidate WASM modules in Vite's module graph
  -> server.reloadModule() triggers HMR
  -> import.meta.hot.accept() (auto-injected) picks up new module
```

### Change Detection

The plugin uses Node.js `fs.watch()` directly instead of Vite's built-in watcher (chokidar), because the Rust crate typically lives outside the Vite project root and chokidar only watches within it.

**Watched paths:**

| Path | Filter | Notes |
|---|---|---|
| `<crate>/src/` | `*.rs` only (recursive) | All subdirectories are included |
| `<crate>/Cargo.toml` | — | Triggers rebuild on dependency/feature changes |

Changes to other files (e.g. `build.rs` at the crate root, non-`.rs` files in `src/`) are **not** detected.

**Build queuing:** If a new change arrives while `wasm-pack` is already running, the rebuild is queued and runs once the current build finishes. Only one queued rebuild is retained — rapid changes during a long build collapse into a single follow-up build.

## Options

```ts
wasmHmr({
  // Required: path to Rust crate, relative to Vite root
  crate: "../my-crate",

  // Output directory name within the crate (default: "pkg")
  outDir: "pkg",

  // Debounce interval in ms (default: 300)
  debounceMs: 300,

  // Extra args appended to: wasm-pack build --target bundler (default: ["--dev"])
  wasmPackArgs: ["--dev"],

  // Package name for import resolution (default: auto-detected from pkg/package.json)
  packageName: "my-wasm-pkg",

  // Run wasm-pack build on server start (default: true)
  buildOnStart: true,
});
```

## WASM Package Resolution

Your app needs to resolve the wasm-pack output as a package. Two common approaches:

**Workspace package (monorepo, recommended):**

```yaml
# pnpm-workspace.yaml
packages:
  - apps/my-app
  - apps/wasm/pkg
```

```json
// apps/my-app/package.json
{ "dependencies": { "my-wasm-pkg": "workspace:*" } }
```

## Requirements

- Vite 6, 7, or 8
- wasm-pack

## License

MIT
