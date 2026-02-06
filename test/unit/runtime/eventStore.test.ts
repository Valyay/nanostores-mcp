import { describe, expect, it } from "vitest";
import { createLoggerEventStore } from "../../../src/domain/runtime/eventStore.ts";

function createEvent(kind: string, storeName: string, timestamp: number, extra: Record<string, unknown> = {}) {
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
		expect(stats.totalEvents).toBe(3);
		expect(store.getEvents().map(event => event.timestamp)).toEqual([2, 3, 4]);
		expect(store.getEvents({ storeName: "$a" }).length).toBe(2);
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

	it("clears events and stats", () => {
		const store = createLoggerEventStore(10);
		store.add(createEvent("change", "$a", 1));
		store.clear();

		expect(store.getStats().totalEvents).toBe(0);
		expect(store.getStats().stores.length).toBe(0);
	});
});
