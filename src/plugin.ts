import { watch } from "node:fs";
import { join } from "node:path";
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

		// Suppress Vite's default HMR for pkg/ files.
		// We handle HMR ourselves via configureServer after wasm-pack build.
		hotUpdate({ file }) {
			if (file.startsWith(opts.pkgDir)) {
				return [];
			}
		},
	};
}

function triggerHmr(server: ViteDevServer, opts: ResolvedOptions) {
	// Invalidate all modules from pkg/
	for (const [file, mods] of server.moduleGraph.fileToModulesMap) {
		if (file.startsWith(opts.pkgDir)) {
			for (const mod of mods) {
				server.moduleGraph.invalidateModule(mod);
			}
		}
	}

	// Find the entry module and trigger HMR reload
	const entryFile = join(opts.pkgDir, opts.entryFileName);
	const entryMods = server.moduleGraph.getModulesByFile(entryFile);
	if (entryMods) {
		for (const mod of entryMods) {
			server.reloadModule(mod);
			break;
		}
	}
}
