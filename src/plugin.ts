import { join } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { createBuilder } from "./builder.js";
import {
  type ResolvedOptions,
  type WasmHotReloadOptions,
  resolveOptions,
} from "./options.js";

export function wasmHotReload(rawOptions: WasmHotReloadOptions): Plugin {
  let opts: ResolvedOptions;
  let isServe = false;

  return {
    name: "wasm-hotreload",

    configResolved(config) {
      isServe = config.command === "serve";
      opts = resolveOptions(rawOptions, config.root, isServe);
    },

    transform(code, id) {
      if (!isServe) return null;

      const normalized = id.split("?")[0];
      if (!normalized.startsWith(opts.pkgDir)) return null;
      if (!normalized.endsWith(".js")) return null;
      if (normalized.endsWith("_bg.js")) return null;

      return {
        code: `${code}\nif (import.meta.hot) { import.meta.hot.accept(); }\n`,
        map: null,
      };
    },

    configureServer(server) {
      const builder = createBuilder(opts, server.config.logger);

      // Add Rust source paths to Vite's chokidar watcher
      const watchPaths = opts.watchPatterns.map((p) =>
        join(opts.crateDir, p),
      );
      server.watcher.add(watchPaths);

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      async function onRebuild() {
        const result = await builder.build();
        if (!result.ok) {
          server.hot.send({
            type: "error",
            err: {
              message: result.error.message,
              stack: result.error.stack ?? "",
              plugin: "wasm-hotreload",
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

      // Listen for Rust source changes
      server.watcher.on("change", (file) => {
        if (!file.startsWith(opts.crateDir)) return;
        // Ignore changes in pkg/ and pkg-staging/ (our own output)
        if (file.startsWith(opts.pkgDir) || file.startsWith(opts.stagingDir))
          return;
        if (!file.endsWith(".rs") && !file.endsWith("Cargo.toml")) return;

        server.config.logger.info(
          `[wasm-hotreload] Change detected: ${file}`,
          { timestamp: true },
        );
        scheduleRebuild();
      });

      // Initial build on server start
      if (opts.buildOnStart) {
        onRebuild();
      }
    },

    handleHotUpdate({ file }) {
      // Suppress Vite's default HMR for pkg/ files.
      // We handle HMR ourselves via configureServer after wasm-pack build.
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
    }
  }
}
