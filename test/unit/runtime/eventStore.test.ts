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

	it("clears events and stats", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("change", "$a", 1));
		store.clear();

		expect(store.getStats().totalEvents).toBe(0);
		expect(store.getStats().stores.length).toBe(0);
	});
});
