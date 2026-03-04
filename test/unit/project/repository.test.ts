import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import { createProjectIndexRepository } from "../../../src/domain/project/repository.ts";
import * as scanner from "../../../src/domain/project/scanner/index.ts";

const FILES = ["/root/src/store.ts", "/root/src/App.tsx"];

const index: ProjectIndex = {
	rootDir: "/root",
	filesScanned: 2,
	stores: [],
	subscribers: [],
	relations: [],
};

describe("project/repository", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns cached index when files have not changed", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(1);
	});

	it("rescans when a file mtime changes", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		const mtimeSpy = vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(1);

		// Simulate file modification
		mtimeSpy.mockResolvedValue(2000);
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(2);
	});

	it("rescans when a file is added", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		const discoverSpy = vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(1);

		// Simulate new file
		discoverSpy.mockResolvedValue([...FILES, "/root/src/new.ts"]);
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(2);
	});

	it("rescans when a file is deleted", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		const discoverSpy = vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(1);

		// Simulate file deletion
		discoverSpy.mockResolvedValue([FILES[0]]);
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(2);
	});

	it("rescans when force is true", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		await repo.getIndex("/root", { force: true });
		expect(scanSpy).toHaveBeenCalledTimes(2);
	});

	it("falls back to rescan if mtime check throws", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		const discoverSpy = vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(1);

		// Simulate filesystem error during mtime check (only once)
		discoverSpy.mockRejectedValueOnce(new Error("EACCES")).mockResolvedValue(FILES);
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(2);
	});

	it("shares in-flight scans for concurrent calls", async () => {
		const scanSpy = vi
			.spyOn(scanner, "scanProject")
			.mockImplementation(async () => ({ ...index, filesScanned: 2 }));
		vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		const [first, second] = await Promise.all([repo.getIndex("/root"), repo.getIndex("/root")]);
		expect(first.filesScanned).toBe(2);
		expect(second.filesScanned).toBe(2);
		expect(scanSpy).toHaveBeenCalledTimes(1);
	});

	it("clearCache forces rescan on next call", async () => {
		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		vi.spyOn(scanner, "discoverSourceFiles").mockResolvedValue(FILES);
		vi.spyOn(scanner, "getFilesMaxMtime").mockResolvedValue(1000);

		const repo = createProjectIndexRepository();

		await repo.getIndex("/root");
		repo.clearCache();
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(2);
	});
});
