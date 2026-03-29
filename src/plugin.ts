import { watch } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { createBuilder } from "./builder.js";
import {
	type ResolvedOptions,
	resolveOptions,
	type WasmHmrOptions,
} from "./options.js";

export function wasmHmr(rawOptions: WasmHmrOptions): Plugin {
	let opts: ResolvedOptions;

	return {
		name: "wasm-hmr",

		config(userConfig) {
			const root = resolve(userConfig.root ?? process.cwd());
			opts = resolveOptions(rawOptions, root);
			return {
				optimizeDeps: {
					exclude: [opts.packageName],
				},
			};
		},

		configResolved(config) {
			opts = resolveOptions(rawOptions, config.root);
		},

		configureServer(server) {
			const builder = createBuilder(opts, server.config.logger);
			const logger = server.config.logger;

			let debounceTimer: ReturnType<typeof setTimeout> | null = null;
			const changedFiles = new Set<string>();

			async function onRebuild() {
				const files = [...changedFiles];
				changedFiles.clear();
				for (const f of files) {
					logger.info(`[wasm-hmr] Change detected: ${f}`, {
						timestamp: true,
					});
				}

				const result = await builder.build();
				if (!result.ok) {
					server.hot.send({
						type: "error",
						err: {
							message: result.error.message,
							stack: result.error.stack ?? "",
							plugin: "wasm-hmr",
							id: opts.crateDir,
						},
					});
					return;
				}

				// HMR is handled by Vite's native file watcher.
				// When wasm-pack output is copied to pkg/, Vite detects the
				// file changes and triggers HMR with proper timestamps for
				// client-side cache busting.
			}

			function scheduleRebuild() {
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(onRebuild, opts.debounceMs);
			}

			// Use Node.js fs.watch directly instead of Vite's watcher,
			// which does not pick up changes outside the project root.
			const srcDir = join(opts.crateDir, "src");

			watch(srcDir, { recursive: true }, (_event, filename) => {
				if (!filename) return;
				if (!filename.endsWith(".rs")) return;
				changedFiles.add(join(srcDir, filename));
				scheduleRebuild();
			});

			watch(join(opts.crateDir, "Cargo.toml"), () => {
				changedFiles.add(join(opts.crateDir, "Cargo.toml"));
				scheduleRebuild();
			});

			// Initial build on server start
			if (opts.buildOnStart) {
				onRebuild();
			}
		},
	};
}
