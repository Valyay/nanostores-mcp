import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

function createMockActionEvents(storeName: string) {
	const actionId = nanoid();

	return [
		{
			kind: "action-start",
			storeName,
			timestamp: Date.now(),
			actionId,
			actionName: "testAction",
		},
		{
			kind: "action-end",
			storeName,
			timestamp: Date.now(),
			actionId,
			actionName: "testAction",
		},
		{
			kind: "action-error",
			storeName,
			timestamp: Date.now(),
			actionId,
			actionName: "testAction",
			error: "test error",
		},
	];
}

function isValidEvent(event: unknown): boolean {
	if (typeof event !== "object" || event === null) return false;

	const e = event as Record<string, unknown>;

	if (typeof e.kind !== "string") return false;
	if (typeof e.storeName !== "string") return false;
	if (typeof e.timestamp !== "number") return false;

	const validKinds = ["mount", "unmount", "change", "action-start", "action-end", "action-error"];
	if (!validKinds.includes(e.kind)) return false;

	if (e.kind === "action-start" || e.kind === "action-end" || e.kind === "action-error") {
		if (typeof e.actionId !== "string") return false;
		if (typeof e.actionName !== "string") return false;
	}

	return true;
}

describe("loggerBridge validation", () => {
	it("accepts action events with string actionId", () => {
		const events = createMockActionEvents("testStore");

		for (const event of events) {
			expect(isValidEvent(event)).toBe(true);
		}
	});

	it("rejects action events with numeric actionId", () => {
		const invalidEvent = {
			kind: "action-start",
			storeName: "testStore",
			timestamp: Date.now(),
			actionId: 123,
			actionName: "testAction",
		};

		expect(isValidEvent(invalidEvent)).toBe(false);
	});

	it("accepts mount, unmount, and change events", () => {
		expect(
			isValidEvent({
				kind: "mount",
				storeName: "testStore",
				timestamp: Date.now(),
			}),
		).toBe(true);

		expect(
			isValidEvent({
				kind: "unmount",
				storeName: "testStore",
				timestamp: Date.now(),
			}),
		).toBe(true);

		expect(
			isValidEvent({
				kind: "change",
				storeName: "testStore",
				timestamp: Date.now(),
				valueMessage: "test value",
			}),
		).toBe(true);
	});

	it("rejects events with missing required fields", () => {
		const invalidEvents = [
			{ kind: "mount", timestamp: Date.now() },
			{ storeName: "test", timestamp: Date.now() },
			{ kind: "mount", storeName: "test" },
			{
				kind: "action-start",
				storeName: "test",
				timestamp: Date.now(),
			},
		];

		for (const event of invalidEvents) {
			expect(isValidEvent(event)).toBe(false);
		}
	});
});
