import { execFile } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import type { Logger } from "vite";
import type { ResolvedOptions } from "./options.js";

export type BuildResult =
  | { ok: true; durationMs: number }
  | { ok: false; error: Error };

export function createBuilder(opts: ResolvedOptions, logger: Logger) {
  let building = false;
  let pendingRebuild = false;

  async function runWasmPack(): Promise<BuildResult> {
    const start = performance.now();
    try {
      await spawn("wasm-pack", [
        "build",
        opts.crateDir,
        "--target",
        opts.target,
        "--out-dir",
        `${opts.outDir}-staging`,
        ...opts.wasmPackArgs,
      ]);
      await mkdir(opts.pkgDir, { recursive: true });
      await cp(opts.stagingDir, opts.pkgDir, { recursive: true, force: true });
      return { ok: true, durationMs: Math.round(performance.now() - start) };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }

  async function build(): Promise<BuildResult> {
    if (building) {
      pendingRebuild = true;
      return { ok: true, durationMs: 0 };
    }

    building = true;
    logger.info("[wasm-hotreload] Building...", { timestamp: true });

    let result = await runWasmPack();

    // Process pending rebuild if another change arrived during build
    while (pendingRebuild) {
      pendingRebuild = false;
      logger.info("[wasm-hotreload] Rebuilding (queued change)...", {
        timestamp: true,
      });
      result = await runWasmPack();
    }

    building = false;

    if (result.ok) {
      logger.info(
        `[wasm-hotreload] Build complete (${result.durationMs}ms)`,
        { timestamp: true },
      );
    } else {
      logger.error(
        `[wasm-hotreload] Build failed: ${result.error.message}`,
        { timestamp: true },
      );
    }

    return result;
  }

  return { build };
}

function spawn(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) {
        const message = stderr || stdout || err.message;
        reject(new Error(message));
      } else {
        resolve(stdout);
      }
    });
  });
}
