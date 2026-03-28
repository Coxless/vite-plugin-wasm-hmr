# vite-plugin-wasm-hotreload

Vite plugin that watches Rust source files, rebuilds with wasm-pack, and triggers HMR — all within the Vite dev server. No separate watcher process, no sentinel files.

## Install

```bash
npm install -D vite-plugin-wasm-hotreload
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
import { wasmHotReload } from "vite-plugin-wasm-hotreload";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    wasmHotReload({ crate: "../wasm" }), // path to your Rust crate
  ],
});
```

`crate` is the only required option. The package name is auto-detected from `pkg/package.json`.

### 2. Use WASM in your code

**Vanilla JS/TS** — just import. HMR works automatically:

```ts
import { greet } from "my-wasm-pkg";

greet("world");
```

**React** — use the provided hook for async loading:

```tsx
import { useWasm } from "vite-plugin-wasm-hotreload/react";

const loadWasm = () => import("my-wasm-pkg");

export function App() {
  const { wasm, loading, error } = useWasm(loadWasm);

  if (loading) return <p>Loading WASM...</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <p>Result: {wasm!.add(1, 2)}</p>;
}
```

### 3. Run dev server

```bash
npx vite
```

That's it. Edit your `.rs` files and see changes reflected in the browser without a full reload.

## How It Works

```
*.rs saved
  -> Vite's file watcher detects change
  -> Debounce (300ms)
  -> wasm-pack build --dev -> pkg-staging/
  -> Copy pkg-staging/ -> pkg/
  -> Invalidate WASM modules in Vite's module graph
  -> server.reloadModule() triggers HMR
  -> import.meta.hot.accept() (auto-injected) picks up new module
  -> React Refresh re-renders components
```

## Options

```ts
wasmHotReload({
  // Required: path to Rust crate, relative to Vite root
  crate: "../my-crate",

  // wasm-pack --target (default: "bundler")
  target: "bundler",

  // Output directory name within the crate (default: "pkg")
  outDir: "pkg",

  // Debounce interval in ms (default: 300)
  debounceMs: 300,

  // Extra wasm-pack args (default: ["--dev"] in dev, [] in build)
  wasmPackArgs: ["--dev"],

  // Watch patterns relative to crate dir (default: ["src/**/*.rs", "Cargo.toml"])
  watchPatterns: ["src/**/*.rs", "Cargo.toml"],

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

**Vite alias:**

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    alias: { "my-wasm-pkg": path.resolve(__dirname, "../wasm/pkg") },
  },
});
```

## Requirements

- Vite 5, 6, 7, or 8
- wasm-pack
- React 18 or 19 (optional, only for `useWasm` hook)

## License

MIT
