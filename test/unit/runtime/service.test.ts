import { describe, expect, it, vi } from "vitest";
import type { ProjectAnalysisService } from "../../../src/domain/project/service.ts";
import { createLoggerEventStore } from "../../../src/domain/runtime/eventStore.ts";
import { createRuntimeAnalysisService } from "../../../src/domain/runtime/service.ts";

const storeMatch = {
	id: "store:src/stores/counter.ts#$count",
	file: "src/stores/counter.ts",
	line: 1,
	kind: "atom" as const,
	name: "$count",
};

describe("runtime/service", () => {
	it("enriches profiles with static data when available", async () => {
		const eventStore = createLoggerEventStore(10);
		const now = 10_000;
		eventStore.add({ kind: "change", storeName: "$count", timestamp: now - 2000 });
		eventStore.add({ kind: "change", storeName: "$count", timestamp: now - 1000 });
		eventStore.add({
			kind: "action-error",
			storeName: "$count",
			timestamp: now - 500,
			actionId: "a1",
			actionName: "inc",
		});

		const projectService = {
			findStoreByRuntimeKey: vi.fn(async () => storeMatch),
		} as unknown as ProjectAnalysisService;

		const runtimeService = createRuntimeAnalysisService(eventStore, projectService, {
			activeThresholdMs: 60_000,
			recentEventsLimit: 2,
		});

		const profile = await runtimeService.getStoreProfile("$count", "/root");
		expect(profile?.id).toBe(storeMatch.id);
		expect(profile?.kind).toBe("atom");
		expect(profile?.file).toBe(storeMatch.file);
		expect(profile?.recentEvents.length).toBe(2);
		expect(profile?.errorRate).toBeGreaterThan(0);
	});

	it("returns profiles without static data when lookup fails", async () => {
		const eventStore = createLoggerEventStore(5);
		eventStore.add({ kind: "change", storeName: "$ghost", timestamp: 1000 });

		const projectService = {
			findStoreByRuntimeKey: vi.fn(async () => {
				throw new Error("boom");
			}),
		} as unknown as ProjectAnalysisService;

		const runtimeService = createRuntimeAnalysisService(eventStore, projectService);
		const profile = await runtimeService.getStoreProfile("$ghost", "/root");

		expect(profile?.storeName).toBe("$ghost");
		expect(profile?.id).toBeUndefined();
	});
});
