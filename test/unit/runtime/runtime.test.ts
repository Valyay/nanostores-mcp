import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import {
	createLoggerEventStore,
	createProjectAnalysisService,
	createRuntimeAnalysisService,
} from "../../../src/domain/index.ts";

const projectIndex: ProjectIndex = {
	rootDir: "/workspace",
	filesScanned: 1,
	stores: [
		{
			id: "store:src/stores/counter.ts#$count",
			file: "src/stores/counter.ts",
			line: 1,
			kind: "atom",
			name: "$count",
		},
		{
			id: "store:src/stores/cart.ts#$cart",
			file: "src/stores/cart.ts",
			line: 1,
			kind: "map",
			name: "$cart",
		},
	],
	subscribers: [],
	relations: [],
};

function createRuntimeFixture() {
	const eventStore = createLoggerEventStore(100);
	const now = Date.now();

	const countEvents = [
		{
			kind: "mount",
			storeName: "$count",
			timestamp: now - 5000,
			projectRoot: "/workspace",
		},
		{
			kind: "change",
			storeName: "$count",
			timestamp: now - 4000,
			actionName: "inc",
			projectRoot: "/workspace",
		},
		{
			kind: "action-start",
			storeName: "$count",
			timestamp: now - 3500,
			actionId: "a1",
			actionName: "inc",
			projectRoot: "/workspace",
		},
		{
			kind: "action-end",
			storeName: "$count",
			timestamp: now - 3000,
			actionId: "a1",
			actionName: "inc",
			projectRoot: "/workspace",
		},
		{
			kind: "action-start",
			storeName: "$count",
			timestamp: now - 2500,
			actionId: "a2",
			actionName: "inc",
			projectRoot: "/workspace",
		},
		{
			kind: "action-error",
			storeName: "$count",
			timestamp: now - 2000,
			actionId: "a2",
			actionName: "inc",
			projectRoot: "/workspace",
		},
		{
			kind: "change",
			storeName: "$count",
			timestamp: now - 1000,
			actionName: "inc",
			projectRoot: "/workspace",
		},
	];

	const cartEvents = [
		{
			kind: "change",
			storeName: "$cart",
			timestamp: now - 1500,
			actionName: "add",
			projectRoot: "/workspace",
		},
	];

	eventStore.addMany([...countEvents, ...cartEvents]);

	const repository = {
		getIndex: async (_root: string) => projectIndex,
		clearCache: (_root?: string) => {},
	};
	const projectService = createProjectAnalysisService(repository);
	const runtimeService = createRuntimeAnalysisService(eventStore, projectService, {
		activeThresholdMs: 60_000,
		recentEventsLimit: 3,
	});

	return { eventStore, runtimeService, now };
}

describe("runtime domain: logger event store", () => {
	it("aggregates events and supports filters", () => {
		const { eventStore } = createRuntimeFixture();

		const stats = eventStore.getStats();
		expect(stats.totalEvents).toBe(8);

		expect(eventStore.getEvents({ storeName: "$count" }).length).toBe(7);
		expect(eventStore.getEvents({ storeName: "$count", kinds: ["change"] }).length).toBe(2);
		expect(eventStore.getEvents({ actionName: "inc" }).length).toBe(6);

		const noisy = eventStore.getNoisyStores(1);
		expect(noisy[0].storeName).toBe("$count");

		expect(eventStore.getErrorProneStores(1).some(store => store.storeName === "$count")).toBe(
			true,
		);
		expect(eventStore.getUnmountedStores().some(store => store.storeName === "$cart")).toBe(true);
	});
});

describe("runtime domain: analysis service", () => {
	it("builds enriched store profiles with metrics", async () => {
		const { runtimeService, now } = createRuntimeFixture();

		const profile = await runtimeService.getStoreProfile("$count", "/workspace");
		expect(profile?.id).toBe("store:src/stores/counter.ts#$count");
		expect(profile?.kind).toBe("atom");
		expect(profile?.file).toBe("src/stores/counter.ts");
		expect(profile?.stats.changes).toBe(2);
		expect(profile?.stats.actionsStarted).toBe(2);
		expect(profile?.stats.actionsErrored).toBe(1);
		expect(profile?.errorRate).toBe(50);
		expect(Math.abs(profile!.changeRate - 0.5)).toBeLessThan(0.01);
		expect(profile?.recentEvents.length).toBe(3);
		expect(profile?.isActive).toBe(true);
		expect(profile!.secondsSinceLastActivity).toBeGreaterThanOrEqual(0);
		expect(profile!.secondsSinceLastActivity).toBeLessThanOrEqual(60);

		const recentEvents = runtimeService.getEvents({ sinceTs: now - 2000 });
		expect(recentEvents.length).toBeGreaterThan(0);

		const profiles = await runtimeService.getStoreProfiles(["$count", "$missing"], "/workspace");
		expect(profiles.length).toBe(1);

		const missing = await runtimeService.getStoreProfile("$missing", "/workspace");
		expect(missing).toBeNull();
	});
});
