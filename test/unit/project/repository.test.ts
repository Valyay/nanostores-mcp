import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import { createProjectIndexRepository } from "../../../src/domain/project/repository.ts";
import * as scanner from "../../../src/domain/project/scanner/index.ts";

const index: ProjectIndex = {
	rootDir: "/root",
	filesScanned: 1,
	stores: [],
	subscribers: [],
	relations: [],
};

describe("project/repository", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("caches results until TTL expires and respects force", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);

		const scanSpy = vi.spyOn(scanner, "scanProject").mockResolvedValue(index);
		const repo = createProjectIndexRepository(1000);

		await repo.getIndex("/root");
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(1);

		vi.setSystemTime(2000);
		await repo.getIndex("/root");
		expect(scanSpy).toHaveBeenCalledTimes(2);

		await repo.getIndex("/root", { force: true });
		expect(scanSpy).toHaveBeenCalledTimes(3);
	});

	it("shares in-flight scans for concurrent calls", async () => {
		const scanSpy = vi
			.spyOn(scanner, "scanProject")
			.mockImplementation(async () => ({ ...index, filesScanned: 2 }));
		const repo = createProjectIndexRepository(1000);

		const [first, second] = await Promise.all([repo.getIndex("/root"), repo.getIndex("/root")]);
		expect(first.filesScanned).toBe(2);
		expect(second.filesScanned).toBe(2);
		expect(scanSpy).toHaveBeenCalledTimes(1);
	});
});
