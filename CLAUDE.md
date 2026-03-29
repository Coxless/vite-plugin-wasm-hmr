# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Vite plugin that enables hot module reload for WebAssembly modules built with `wasm-pack`. When Rust source files change, the plugin rebuilds via wasm-pack and triggers Vite HMR so the browser updates without a full page reload.

## Commands

- **Build:** `pnpm build` (runs tsup, outputs to `dist/`)
- **Dev:** `pnpm dev` (tsup in watch mode)
- No tests or linter configured.

## Architecture

The plugin has three modules under `src/`:

- **plugin.ts** — Core Vite plugin. Uses Node.js `fs.watch()` (not Vite's watcher) to detect changes in the Rust crate's `src/` and `Cargo.toml`. Debounces file events, triggers rebuilds, and sends HMR updates via Vite's module graph. Suppresses Vite's default HMR for `pkg/` files since the plugin handles that itself.
- **builder.ts** — Spawns `wasm-pack build`, manages build queueing (prevents concurrent builds, auto-rebuilds if changes arrive mid-build). Uses a staging directory (`pkg-staging/`) then copies to `pkg/`.
- **options.ts** — Resolves user config to internal `ResolvedOptions`. Auto-detects the WASM package name from `pkg/package.json`.

**Key design decision:** `fs.watch()` is used directly because Vite's built-in watcher (chokidar) does not detect changes outside the Vite project root, and the Rust crate is typically in a sibling directory.

## Package Exports

Single entry point built by tsup:
- `.` → `src/index.ts` (plugin factory + types)

Peer dependencies: `vite ^6–8`.
