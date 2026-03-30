import { watch } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
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

				triggerHmr(server, opts);
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

		// Suppress Vite's native HMR for pkg/ files to prevent duplicate
		// updates (one per changed file). We trigger a single coordinated
		// HMR update in triggerHmr after the build completes.
		hotUpdate({ file }) {
			if (file.startsWith(opts.pkgDir)) {
				return [];
			}
		},
	};
}

function triggerHmr(server: ViteDevServer, opts: ResolvedOptions) {
	const timestamp = Date.now();

	// Invalidate with isHmr=true so lastHMRTimestamp is set,
	// enabling client-side URL cache busting on re-import.
	for (const [file, mods] of server.moduleGraph.fileToModulesMap) {
		if (file.startsWith(opts.pkgDir)) {
			for (const mod of mods) {
				server.moduleGraph.invalidateModule(mod, undefined, timestamp, true);
			}
		}
	}

	const entryFile = join(opts.pkgDir, opts.entryFileName);
	const entryMods = server.moduleGraph.getModulesByFile(entryFile);
	if (entryMods) {
		for (const mod of entryMods) {
			server.reloadModule(mod);
			break;
		}
	}
}
