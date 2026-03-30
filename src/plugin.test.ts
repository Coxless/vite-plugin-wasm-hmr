import { watch } from "node:fs";
import type { Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBuilder } from "./builder.js";
import { wasmHmr } from "./plugin.js";

vi.mock("node:fs", () => ({
	watch: vi.fn(),
}));

vi.mock("./builder.js", () => ({
	createBuilder: vi.fn(),
}));

const mockWatch = vi.mocked(watch);
const mockCreateBuilder = vi.mocked(createBuilder);

function makeServer() {
	return {
		config: {
			logger: {
				info: vi.fn(),
				warn: vi.fn(),
				warnOnce: vi.fn(),
				error: vi.fn(),
				clearScreen: vi.fn(),
				hasWarned: false,
				hasErrorLogged: vi.fn().mockReturnValue(false),
			},
		},
		hot: { send: vi.fn() },
		moduleGraph: {
			fileToModulesMap: new Map<
				string,
				Set<{ id: string; url: string; file: string | null }>
			>(),
			invalidateModule: vi.fn(),
			getModulesByFile: vi.fn().mockReturnValue(null),
		},
		reloadModule: vi.fn(),
	};
}

/** Initialises plugin opts by calling the config hook with the given root. */
function initPlugin(
	rawOptions: Parameters<typeof wasmHmr>[0],
	root = "/project",
): Plugin {
	const plugin = wasmHmr(rawOptions);
	// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
	(plugin as any).config({ root }, {});
	return plugin;
}

describe("wasmHmr plugin", () => {
	it('has the plugin name "wasm-hmr"', () => {
		expect(wasmHmr({ crate: "./crate" }).name).toBe("wasm-hmr");
	});

	describe("config hook", () => {
		it("excludes the WASM package from optimizeDeps", () => {
			const plugin = wasmHmr({ crate: "./crate", packageName: "my-wasm" });
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			const result = (plugin as any).config({ root: "/project" }, {});
			expect(result.optimizeDeps.exclude).toContain("my-wasm");
		});
	});

	describe("hotUpdate hook", () => {
		let plugin: Plugin;

		beforeEach(() => {
			plugin = initPlugin({ crate: "./crate", packageName: "my-wasm" });
		});

		it("returns [] to suppress HMR for files inside pkgDir", () => {
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			const result = (plugin as any).hotUpdate({
				file: "/project/crate/pkg/my-wasm.js",
			});
			expect(result).toEqual([]);
		});

		it("returns undefined to allow HMR for files outside pkgDir", () => {
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			const result = (plugin as any).hotUpdate({
				file: "/project/src/main.ts",
			});
			expect(result).toBeUndefined();
		});
	});

	describe("configureServer hook", () => {
		const mockBuild = vi.fn();

		beforeEach(() => {
			mockBuild.mockReset();
			mockBuild.mockResolvedValue({ ok: true, durationMs: 50 });
			mockCreateBuilder.mockReturnValue({ build: mockBuild });
			mockWatch.mockReturnValue({ close: vi.fn() } as never);
		});

		it("watches Rust src/ directory and Cargo.toml", () => {
			const plugin = initPlugin({
				crate: "./crate",
				packageName: "my-wasm",
				buildOnStart: false,
			});
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			(plugin as any).configureServer(makeServer());

			const watchedPaths = mockWatch.mock.calls.map((c) => String(c[0]));
			expect(watchedPaths.some((p) => p.endsWith("/src"))).toBe(true);
			expect(watchedPaths.some((p) => p.endsWith("Cargo.toml"))).toBe(true);
		});

		it("triggers an initial build when buildOnStart is true", async () => {
			const plugin = initPlugin({
				crate: "./crate",
				packageName: "my-wasm",
				buildOnStart: true,
			});
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			(plugin as any).configureServer(makeServer());

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(mockBuild).toHaveBeenCalledOnce();
		});

		it("skips the initial build when buildOnStart is false", async () => {
			const plugin = initPlugin({
				crate: "./crate",
				packageName: "my-wasm",
				buildOnStart: false,
			});
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			(plugin as any).configureServer(makeServer());

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(mockBuild).not.toHaveBeenCalled();
		});

		it("sends an HMR error event when the build fails", async () => {
			mockBuild.mockResolvedValue({
				ok: false,
				error: new Error("compile error"),
			});
			const plugin = initPlugin({
				crate: "./crate",
				packageName: "my-wasm",
				buildOnStart: true,
			});
			const server = makeServer();
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			(plugin as any).configureServer(server);

			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(server.hot.send).toHaveBeenCalledWith(
				expect.objectContaining({ type: "error" }),
			);
		});

		it("schedules a rebuild after debounce when an .rs file changes", async () => {
			vi.useFakeTimers();

			let srcWatchCb!: (event: string, filename: string) => void;
			mockWatch.mockImplementation((...args: unknown[]) => {
				// watch(path, { recursive: true }, callback)
				if (
					typeof args[1] === "object" &&
					typeof args[2] === "function" &&
					String(args[0]).endsWith("/src")
				) {
					srcWatchCb = args[2] as typeof srcWatchCb;
				}
				return { close: vi.fn() } as never;
			});

			const plugin = initPlugin({
				crate: "./crate",
				packageName: "my-wasm",
				buildOnStart: false,
			});
			// biome-ignore lint/suspicious/noExplicitAny: exercising internal hooks
			(plugin as any).configureServer(makeServer());

			srcWatchCb("change", "lib.rs");

			await vi.runAllTimersAsync();

			expect(mockBuild).toHaveBeenCalledOnce();

			vi.useRealTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});
	});
});
