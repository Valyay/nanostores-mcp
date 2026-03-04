import { describe, expect, it } from "vitest";
import type {
	StoreRuntimeStats,
	LoggerStatsSnapshot,
} from "../../../../src/domain/runtime/types.ts";
import {
	buildStoreActivitySummary,
	buildNoisyStoresSummary,
	buildRuntimeOverviewSummary,
} from "../../../../src/mcp/tools/runtime.ts";

function makeStats(overrides: Partial<StoreRuntimeStats> = {}): StoreRuntimeStats {
	return {
		storeName: "$counter",
		firstSeen: 1000,
		lastSeen: 2000,
		mounts: 1,
		unmounts: 0,
		changes: 10,
		actionsStarted: 5,
		actionsErrored: 0,
		actionsCompleted: 5,
		...overrides,
	};
}

function makeSnapshot(overrides: Partial<LoggerStatsSnapshot> = {}): LoggerStatsSnapshot {
	return {
		stores: [],
		totalEvents: 0,
		sessionStartedAt: Date.now() - 60_000,
		lastEventAt: Date.now(),
		...overrides,
	};
}

describe("store_activity tool: summary building", () => {
	it("builds summary for a specific store with stats", () => {
		const stats = makeStats({
			mounts: 3,
			changes: 25,
			actionsStarted: 10,
			actionsCompleted: 9,
			actionsErrored: 1,
		});

		const summary = buildStoreActivitySummary("$counter", stats, true, 0);

		expect(summary).toContain('Store "$counter"');
		expect(summary).toContain("combined with static analysis data");
		expect(summary).toContain("Mounted: 3 times");
		expect(summary).toContain("Changes: 25");
		expect(summary).toContain("Actions errored: 1");
	});

	it("builds summary when no runtime data found", () => {
		const summary = buildStoreActivitySummary("$missing", null, false, 0);

		expect(summary).toContain("No runtime data found");
		expect(summary).toContain("$missing");
	});

	it("builds overall stats summary when no storeName", () => {
		const snapshot = makeSnapshot({
			stores: [makeStats()],
			totalEvents: 42,
		});

		const summary = buildStoreActivitySummary(undefined, snapshot, false, 0);

		expect(summary).toContain("Total stores: 1");
		expect(summary).toContain("Total events: 42");
	});

	it("computes sinceTs from windowMs", () => {
		const now = 10_000;
		const windowMs = 5_000;
		const sinceTs = now - windowMs;
		expect(sinceTs).toBe(5_000);
	});
});

describe("find_noisy_stores tool: filtering and summary", () => {
	it("filters noisy stores by time window", () => {
		const now = Date.now();
		const noisyStores = [
			makeStats({ storeName: "$active", lastSeen: now - 1000, changes: 50, actionsStarted: 20 }),
			makeStats({ storeName: "$old", lastSeen: now - 60_000, changes: 100, actionsStarted: 30 }),
		];

		const windowMs = 5_000;
		const sinceTs = now - windowMs;
		const filtered = noisyStores.filter(s => s.lastSeen >= sinceTs);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].storeName).toBe("$active");
	});

	it("builds summary for noisy stores", () => {
		const stores = [
			makeStats({ storeName: "$fast", changes: 100, actionsStarted: 50, actionsErrored: 2 }),
		];

		const summary = buildNoisyStoresSummary(stores);

		expect(summary).toContain("$fast: 150 total activity");
		expect(summary).toContain("2 errors");
	});

	it("returns empty message when no active stores", () => {
		const summary = buildNoisyStoresSummary([]);
		expect(summary).toBe("No active stores found.");
	});
});

describe("runtime_overview tool: health report", () => {
	it("builds overview with noisy and error-prone stores", () => {
		const stats = makeSnapshot({
			stores: [makeStats({ storeName: "$a" }), makeStats({ storeName: "$b" })],
			totalEvents: 100,
		});

		const noisyStores = [makeStats({ storeName: "$a", changes: 80 })];
		const errorProneStores = [
			makeStats({ storeName: "$b", actionsErrored: 5, actionsStarted: 10 }),
		];

		const summary = buildRuntimeOverviewSummary({
			stats,
			noisyStores,
			errorProneStores,
			unmountedStores: [],
		});

		expect(summary).toContain("Total events: 100");
		expect(summary).toContain("Total stores seen: 2");
		expect(summary).toContain("$a: 80 changes");
		expect(summary).toContain("$b: 5 errors");
	});

	it("shows no-activity message when no stores", () => {
		const stats = makeSnapshot({ stores: [] });

		const summary = buildRuntimeOverviewSummary({
			stats,
			noisyStores: [],
			errorProneStores: [],
			unmountedStores: [],
		});

		expect(summary).toContain("No runtime activity detected.");
	});

	it("filters active stores by windowMs", () => {
		const now = Date.now();
		const stores = [
			makeStats({ storeName: "$recent", lastSeen: now - 1000 }),
			makeStats({ storeName: "$stale", lastSeen: now - 120_000 }),
		];
		const windowMs = 10_000;
		const sinceTs = now - windowMs;
		const active = stores.filter(s => s.lastSeen >= sinceTs);

		expect(active).toHaveLength(1);
		expect(active[0].storeName).toBe("$recent");
	});
});
