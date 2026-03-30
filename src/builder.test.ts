import { execFile } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import type { Logger } from "vite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBuilder } from "./builder.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(),
	cp: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);
const mockMkdir = vi.mocked(mkdir);
const mockCp = vi.mocked(cp);

const opts = {
	crateDir: "/crate",
	outDir: "pkg",
	pkgDir: "/crate/pkg",
	stagingDir: "/crate/pkg-staging",
	debounceMs: 300,
	wasmPackArgs: ["--dev"],
	packageName: "my-wasm",
	entryFileName: "my-wasm.js",
	buildOnStart: true,
};

function makeLogger(): Logger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		warnOnce: vi.fn(),
		error: vi.fn(),
		clearScreen: vi.fn(),
		hasWarned: false,
		hasErrorLogged: vi.fn().mockReturnValue(false),
	};
}

function mockExecSuccess() {
	mockExecFile.mockImplementation((...args: unknown[]) => {
		const cb = args[args.length - 1] as (
			err: Error | null,
			stdout: string,
			stderr: string,
		) => void;
		cb(null, "", "");
		return {} as ReturnType<typeof execFile>;
	});
}

function mockExecFailure(stderr: string) {
	mockExecFile.mockImplementation((...args: unknown[]) => {
		const cb = args[args.length - 1] as (
			err: Error | null,
			stdout: string,
			stderr: string,
		) => void;
		cb(new Error("failed"), "", stderr);
		return {} as ReturnType<typeof execFile>;
	});
}

describe("createBuilder", () => {
	beforeEach(() => {
		mockExecFile.mockReset();
		mockMkdir.mockReset();
		mockCp.mockReset();
		mockMkdir.mockResolvedValue(undefined as never);
		mockCp.mockResolvedValue(undefined as never);
	});

	it("returns ok:true with duration on success", async () => {
		mockExecSuccess();
		const logger = makeLogger();
		const { build } = createBuilder(opts, logger);
		const result = await build();

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Build complete"),
			expect.any(Object),
		);
	});

	it("returns ok:false with stderr as the error message on failure", async () => {
		mockExecFailure("error: expected item, found `mod`");
		const logger = makeLogger();
		const { build } = createBuilder(opts, logger);
		const result = await build();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe("error: expected item, found `mod`");
		}
		expect(logger.error).toHaveBeenCalled();
	});

	it("returns ok:true durationMs:0 immediately when a build is already running", async () => {
		let triggerFirst!: () => void;
		let callCount = 0;

		// First call delays; subsequent calls (queued rebuild) resolve immediately.
		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (
				err: Error | null,
				stdout: string,
				stderr: string,
			) => void;
			callCount++;
			if (callCount === 1) {
				new Promise<void>((resolve) => {
					triggerFirst = resolve;
				}).then(() => cb(null, "", ""));
			} else {
				cb(null, "", "");
			}
			return {} as ReturnType<typeof execFile>;
		});

		const logger = makeLogger();
		const { build } = createBuilder(opts, logger);

		const first = build(); // starts, doesn't finish yet
		const secondResult = await build(); // should return immediately

		expect(secondResult).toEqual({ ok: true, durationMs: 0 });

		// Let the first build (and queued rebuild) finish
		triggerFirst();
		await first;
	});

	it("runs a queued rebuild after the current build finishes", async () => {
		let triggerFirst!: () => void;
		let callCount = 0;

		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (
				err: Error | null,
				stdout: string,
				stderr: string,
			) => void;
			callCount++;
			if (callCount === 1) {
				new Promise<void>((resolve) => {
					triggerFirst = resolve;
				}).then(() => cb(null, "", ""));
			} else {
				cb(null, "", "");
			}
			return {} as ReturnType<typeof execFile>;
		});

		const logger = makeLogger();
		const { build } = createBuilder(opts, logger);

		const first = build();
		build(); // queues a pending rebuild

		triggerFirst();
		await first;

		// wasm-pack should have been invoked twice: initial + queued
		expect(callCount).toBe(2);
	});

	it("passes wasmPackArgs through to wasm-pack", async () => {
		mockExecSuccess();
		const logger = makeLogger();
		const { build } = createBuilder(
			{ ...opts, wasmPackArgs: ["--release"] },
			logger,
		);
		await build();

		const spawnArgs = mockExecFile.mock.calls[0][1] as string[];
		expect(spawnArgs).toContain("--release");
	});
});
