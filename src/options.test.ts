import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { resolveOptions } from "./options.js";

vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

describe("resolveOptions", () => {
	const root = "/project";

	it("applies defaults", () => {
		mockReadFileSync.mockReturnValue(
			JSON.stringify({ name: "my-wasm" }) as never,
		);
		const opts = resolveOptions({ crate: "./crate" }, root);
		expect(opts.outDir).toBe("pkg");
		expect(opts.debounceMs).toBe(300);
		expect(opts.wasmPackArgs).toEqual(["--dev"]);
		expect(opts.buildOnStart).toBe(true);
	});

	it("resolves crateDir relative to viteRoot", () => {
		mockReadFileSync.mockReturnValue(JSON.stringify({ name: "x" }) as never);
		const opts = resolveOptions({ crate: "../crate" }, "/project/app");
		expect(opts.crateDir).toBe("/project/crate");
	});

	it("accepts custom options", () => {
		const opts = resolveOptions(
			{
				crate: "./crate",
				outDir: "out",
				debounceMs: 500,
				wasmPackArgs: ["--release"],
				packageName: "my-pkg",
				buildOnStart: false,
			},
			root,
		);
		expect(opts.outDir).toBe("out");
		expect(opts.debounceMs).toBe(500);
		expect(opts.wasmPackArgs).toEqual(["--release"]);
		expect(opts.packageName).toBe("my-pkg");
		expect(opts.buildOnStart).toBe(false);
	});

	it("derives entryFileName from packageName", () => {
		const opts = resolveOptions(
			{ crate: "./crate", packageName: "foo-wasm" },
			root,
		);
		expect(opts.entryFileName).toBe("foo-wasm.js");
	});

	it("stagingDir is outDir-staging inside crateDir", () => {
		mockReadFileSync.mockReturnValue(JSON.stringify({ name: "x" }) as never);
		const opts = resolveOptions({ crate: "./crate", outDir: "out" }, root);
		expect(opts.stagingDir).toBe("/project/crate/out-staging");
		expect(opts.pkgDir).toBe("/project/crate/out");
	});

	describe("packageName auto-detection", () => {
		it("reads name from pkg/package.json", () => {
			mockReadFileSync.mockReturnValue(
				JSON.stringify({ name: "detected" }) as never,
			);
			const opts = resolveOptions({ crate: "./crate" }, root);
			expect(opts.packageName).toBe("detected");
		});

		it('falls back to "wasm" when file is missing', () => {
			mockReadFileSync.mockImplementation(() => {
				throw new Error("ENOENT");
			});
			const opts = resolveOptions({ crate: "./crate" }, root);
			expect(opts.packageName).toBe("wasm");
		});

		it('falls back to "wasm" when name field is absent', () => {
			mockReadFileSync.mockReturnValue(JSON.stringify({}) as never);
			const opts = resolveOptions({ crate: "./crate" }, root);
			expect(opts.packageName).toBe("wasm");
		});
	});
});
