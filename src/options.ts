import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

export interface WasmHotReloadOptions {
  /** Path to the Rust crate, relative to Vite root. Required. */
  crate: string;
  /** wasm-pack --target value. Default: "bundler" */
  target?: "bundler" | "web";
  /** Output directory name within the crate. Default: "pkg" */
  outDir?: string;
  /** Debounce interval in ms. Default: 300 */
  debounceMs?: number;
  /** Extra args passed to wasm-pack build. Default: ["--dev"] in serve mode */
  wasmPackArgs?: string[];
  /** Glob patterns to watch, relative to crate dir. Defaults to .rs files and Cargo.toml */
  watchPatterns?: string[];
  /** The package name used in import statements. Auto-detected from pkg/package.json if omitted. */
  packageName?: string;
  /** Whether to run wasm-pack build when the dev server starts. Default: true */
  buildOnStart?: boolean;
}

export interface ResolvedOptions {
  crateDir: string;
  target: "bundler" | "web";
  outDir: string;
  pkgDir: string;
  stagingDir: string;
  debounceMs: number;
  wasmPackArgs: string[];
  watchPatterns: string[];
  packageName: string;
  entryFileName: string;
  buildOnStart: boolean;
}

export function resolveOptions(
  raw: WasmHotReloadOptions,
  viteRoot: string,
  isServe: boolean,
): ResolvedOptions {
  const crateDir = resolve(viteRoot, raw.crate);
  const outDir = raw.outDir ?? "pkg";
  const pkgDir = join(crateDir, outDir);
  const stagingDir = join(crateDir, `${outDir}-staging`);

  const packageName = raw.packageName ?? detectPackageName(pkgDir);
  const entryFileName = `${packageName}.js`;

  return {
    crateDir,
    target: raw.target ?? "bundler",
    outDir,
    pkgDir,
    stagingDir,
    debounceMs: raw.debounceMs ?? 300,
    wasmPackArgs: raw.wasmPackArgs ?? (isServe ? ["--dev"] : []),
    watchPatterns: raw.watchPatterns ?? ["src/**/*.rs", "Cargo.toml"],
    packageName,
    entryFileName,
    buildOnStart: raw.buildOnStart ?? true,
  };
}

function detectPackageName(pkgDir: string): string {
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(pkgDir, "package.json"), "utf-8"),
    );
    return pkgJson.name ?? "wasm";
  } catch {
    return "wasm";
  }
}
