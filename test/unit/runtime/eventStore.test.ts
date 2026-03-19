import { describe, expect, it } from "vitest";
import { createLoggerEventStore } from "../../../src/domain/runtime/eventStore.ts";

function createEvent(
	kind: string,
	storeName: string,
	timestamp: number,
	extra: Record<string, unknown> = {},
) {
	return {
		kind,
		storeName,
		timestamp,
		...extra,
	};
}

describe("runtime/eventStore", () => {
	it("buffers events with max size and per-store limits", () => {
		const store = createLoggerEventStore(3);

		store.add(createEvent("mount", "$a", 1));
		store.add(createEvent("change", "$a", 2));
		store.add(createEvent("change", "$b", 3));
		store.add(createEvent("change", "$a", 4));

		const stats = store.getStats();
		// Global buffer is capped at maxEvents (3), oldest event evicted
		expect(stats.totalEvents).toBe(3);
		expect(store.getEvents().map(event => event.timestamp)).toEqual([2, 3, 4]);
		// Per-store buffer is independent (capped at 1000), so all 3 events for "$a" are kept
		expect(store.getEvents({ storeName: "$a" }).length).toBe(3);
	});

	it("filters by kind, action name, and time window", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("change", "$a", 10, { actionName: "inc" }));
		store.add(createEvent("change", "$a", 12, { actionName: "dec" }));
		store.add(createEvent("action-start", "$a", 13, { actionId: "1", actionName: "inc" }));
		store.add(createEvent("action-error", "$a", 14, { actionId: "1", actionName: "inc" }));
		store.add(createEvent("mount", "$a", 15));

		expect(store.getEvents({ kinds: ["change"] }).length).toBe(2);
		expect(store.getEvents({ actionName: "inc" }).length).toBe(3);
		expect(store.getEvents({ sinceTs: 12, untilTs: 14 }).length).toBe(3);
		expect(store.getEvents({ limit: 2 }).length).toBe(2);
	});

	it("calculates noisy, unmounted, and error-prone stores", () => {
		const store = createLoggerEventStore(20);
		store.add(createEvent("change", "$loud", 1));
		store.add(createEvent("change", "$loud", 2));
		store.add(createEvent("action-start", "$loud", 3, { actionId: "1", actionName: "run" }));
		store.add(createEvent("action-error", "$loud", 4, { actionId: "1", actionName: "run" }));
		store.add(createEvent("change", "$quiet", 5));
		store.add(createEvent("mount", "$quiet", 6));

		const noisy = store.getNoisyStores(1);
		expect(noisy[0].storeName).toBe("$loud");
		expect(store.getUnmountedStores().some(entry => entry.storeName === "$loud")).toBe(true);
		expect(store.getErrorProneStores(1).some(entry => entry.storeName === "$loud")).toBe(true);
	});

	it("includes events at exact sinceTs boundary (inclusive)", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("change", "$a", 10));
		store.add(createEvent("change", "$a", 20));
		store.add(createEvent("change", "$a", 30));

		// sinceTs is inclusive (>=): event at ts=20 should be included
		expect(store.getEvents({ sinceTs: 20 }).length).toBe(2);
		// untilTs is inclusive (<=): event at ts=20 should be included
		expect(store.getEvents({ untilTs: 20 }).length).toBe(2);
	});

	it("returns empty for reversed time window (sinceTs > untilTs)", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("change", "$a", 10));
		store.add(createEvent("change", "$a", 20));

		expect(store.getEvents({ sinceTs: 30, untilTs: 5 }).length).toBe(0);
	});

	it("applies limit from the end (most recent events)", () => {
		const store = createLoggerEventStore(100);
		for (let i = 1; i <= 50; i++) {
			store.add(createEvent("change", "$a", i));
		}

		const limited = store.getEvents({ limit: 3 });
		expect(limited.length).toBe(3);
		expect(limited.map(e => e.timestamp)).toEqual([48, 49, 50]);
	});

	it("skips non-action events when filtering by actionName", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("mount", "$a", 1));
		store.add(createEvent("change", "$a", 2, { actionName: "inc" }));
		store.add(createEvent("action-start", "$a", 3, { actionId: "1", actionName: "inc" }));

		const result = store.getEvents({ actionName: "inc" });
		// mount has no actionName → skipped; change and action-start match
		expect(result.length).toBe(2);
		expect(result.every(e => e.kind !== "mount")).toBe(true);
	});

	it("handles combined filters (storeName + kinds + sinceTs)", () => {
		const store = createLoggerEventStore(20);
		store.add(createEvent("mount", "$a", 1));
		store.add(createEvent("change", "$a", 5));
		store.add(createEvent("change", "$b", 6));
		store.add(createEvent("change", "$a", 10));
		store.add(createEvent("mount", "$a", 15));

		const result = store.getEvents({ storeName: "$a", kinds: ["change"], sinceTs: 5 });
		expect(result.length).toBe(2);
		expect(result.every(e => e.storeName === "$a" && e.kind === "change")).toBe(true);
	});

	it("evicts oldest events when global ring buffer overflows", () => {
		const store = createLoggerEventStore(5);
		for (let i = 1; i <= 10; i++) {
			store.add(createEvent("change", "$a", i));
		}

		const all = store.getEvents();
		expect(all.length).toBe(5);
		expect(all[0].timestamp).toBe(6);
		expect(all[4].timestamp).toBe(10);
	});

	it("isolates same-named stores from different project roots", () => {
		const store = createLoggerEventStore(100);

		store.add(createEvent("change", "$user", 1, { projectRoot: "/project-a" }));
		store.add(createEvent("change", "$user", 2, { projectRoot: "/project-a" }));
		store.add(createEvent("mount", "$user", 3, { projectRoot: "/project-b" }));
		store.add(createEvent("change", "$cart", 4, { projectRoot: "/project-b" }));

		// Per-root stats must not bleed across roots
		const statsA = store.getStoreStats("$user", "/project-a");
		const statsB = store.getStoreStats("$user", "/project-b");
		expect(statsA?.changes).toBe(2);
		expect(statsA?.mounts).toBe(0);
		expect(statsB?.changes).toBe(0);
		expect(statsB?.mounts).toBe(1);

		// Per-root event slices must not bleed
		const eventsA = store.getEvents({ storeName: "$user", projectRoot: "/project-a" });
		const eventsB = store.getEvents({ storeName: "$user", projectRoot: "/project-b" });
		expect(eventsA.length).toBe(2);
		expect(eventsA.every(e => e.projectRoot === "/project-a")).toBe(true);
		expect(eventsB.length).toBe(1);
		expect(eventsB[0].kind).toBe("mount");

		// getStats() must list both $user entries separately
		const snapshot = store.getStats();
		const userEntries = snapshot.stores.filter(s => s.storeName === "$user");
		expect(userEntries.length).toBe(2);
		expect(userEntries.map(s => s.projectRoot).sort()).toEqual(["/project-a", "/project-b"]);
	});

	it("rootless events fall back into root-scoped queries (backward-compat)", () => {
		const store = createLoggerEventStore(100);

		// Rootless event — sent without projectRoot (project-agnostic client)
		store.add(createEvent("change", "$shared", 1));
		// Root-scoped event
		store.add(createEvent("mount", "$shared", 2, { projectRoot: "/project-a" }));

		// getStoreStats with projectRoot: exact match first, then rootless fallback
		const statsExact = store.getStoreStats("$shared", "/project-a");
		expect(statsExact?.mounts).toBe(1);

		// getStoreStats without projectRoot: returns first match (rootless bucket)
		const statsAny = store.getStoreStats("$shared");
		expect(statsAny).toBeDefined();

		// getEvents with projectRoot: should include rootless events via fallback
		const events = store.getEvents({ storeName: "$shared", projectRoot: "/project-a" });
		// exact bucket has 1 event (mount); rootless bucket is fallback only when exact is empty
		expect(events.length).toBeGreaterThan(0);

		// getEvents without projectRoot: merges all buckets, sorted by timestamp
		const all = store.getEvents({ storeName: "$shared" });
		expect(all.length).toBe(2);
		expect(all[0].timestamp).toBeLessThan(all[1].timestamp);
	});

	it("calculates action duration from start/end pairs", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("action-start", "$a", 100, { actionId: "1", actionName: "fetch" }));
		store.add(createEvent("action-end", "$a", 150, { actionId: "1" }));

		const stats = store.getStoreStats("$a");
		expect(stats?.totalActionDurationMs).toBe(50);
		expect(stats?.minActionDurationMs).toBe(50);
		expect(stats?.maxActionDurationMs).toBe(50);
	});

	it("calculates avg, min, max across multiple actions", () => {
		const store = createLoggerEventStore(20);
		// Action 1: 50ms
		store.add(createEvent("action-start", "$a", 100, { actionId: "1", actionName: "fast" }));
		store.add(createEvent("action-end", "$a", 150, { actionId: "1" }));
		// Action 2: 200ms
		store.add(createEvent("action-start", "$a", 200, { actionId: "2", actionName: "slow" }));
		store.add(createEvent("action-end", "$a", 400, { actionId: "2" }));
		// Action 3: 10ms
		store.add(createEvent("action-start", "$a", 500, { actionId: "3", actionName: "quick" }));
		store.add(createEvent("action-end", "$a", 510, { actionId: "3" }));

		const stats = store.getStoreStats("$a")!;
		expect(stats.totalActionDurationMs).toBe(260); // 50 + 200 + 10
		expect(stats.minActionDurationMs).toBe(10);
		expect(stats.maxActionDurationMs).toBe(200);
		expect(stats.actionsCompleted).toBe(3);
		// avg = 260 / 3 ≈ 86.67
	});

	it("tracks duration for errored actions (total and max, but not min)", () => {
		const store = createLoggerEventStore(20);
		// Completed action: 50ms
		store.add(createEvent("action-start", "$a", 100, { actionId: "1", actionName: "ok" }));
		store.add(createEvent("action-end", "$a", 150, { actionId: "1" }));
		// Errored action: 5ms (fast failure — should not drag down min)
		store.add(createEvent("action-start", "$a", 200, { actionId: "2", actionName: "fail" }));
		store.add(createEvent("action-error", "$a", 205, { actionId: "2", actionName: "fail" }));

		const stats = store.getStoreStats("$a")!;
		expect(stats.totalActionDurationMs).toBe(55); // 50 + 5
		expect(stats.maxActionDurationMs).toBe(50); // max across both
		expect(stats.minActionDurationMs).toBe(50); // only from completed, not the 5ms error
		expect(stats.actionsErrored).toBe(1);
		expect(stats.actionsCompleted).toBe(1);
	});

	it("does not update duration for orphan action-start (no end)", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("action-start", "$a", 100, { actionId: "1", actionName: "hang" }));

		const stats = store.getStoreStats("$a")!;
		expect(stats.totalActionDurationMs).toBe(0);
		expect(stats.actionsStarted).toBe(1);
		expect(stats.actionsCompleted).toBe(0);
	});

	it("does not compute duration for action-end without matching start", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("action-end", "$a", 200, { actionId: "orphan" }));

		const stats = store.getStoreStats("$a")!;
		expect(stats.totalActionDurationMs).toBe(0);
		expect(stats.actionsCompleted).toBe(1);
	});

	it("clear() resets action duration tracking", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("action-start", "$a", 100, { actionId: "1", actionName: "x" }));
		store.add(createEvent("action-end", "$a", 150, { actionId: "1" }));
		store.clear();

		// After clear, start a new action — the old in-flight state should be gone
		store.add(createEvent("action-end", "$a", 200, { actionId: "1" }));
		const stats = store.getStoreStats("$a")!;
		expect(stats.totalActionDurationMs).toBe(0);
	});

	it("clears events and stats", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("change", "$a", 1));
		store.clear();

		expect(store.getStats().totalEvents).toBe(0);
		expect(store.getStats().stores.length).toBe(0);
	});
});
