import { describe, it } from "node:test";
import assert from "node:assert";
import { nanoid } from "nanoid";

/**
 * Test helper: simulate events from mcpLogger client
 */
function createMockActionEvents(storeName: string): Array<{
	kind: "action-start" | "action-end" | "action-error";
	storeName: string;
	timestamp: number;
	actionId: string;
	actionName: string;
	error?: string;
}> {
	const actionId = nanoid(); // string, as in mcpLogger

	return [
		{
			kind: "action-start" as const,
			storeName,
			timestamp: Date.now(),
			actionId,
			actionName: "testAction",
		},
		{
			kind: "action-end" as const,
			storeName,
			timestamp: Date.now(),
			actionId,
			actionName: "testAction",
		},
		{
			kind: "action-error" as const,
			storeName,
			timestamp: Date.now(),
			actionId,
			actionName: "testAction",
			error: "test error",
		},
	];
}

/**
 * Inline validation logic for testing (copied from loggerBridge.ts)
 */
function isValidEvent(event: unknown): boolean {
	if (typeof event !== "object" || event === null) return false;

	const e = event as Record<string, unknown>;

	// Check required base fields
	if (typeof e.kind !== "string") return false;
	if (typeof e.storeName !== "string") return false;
	if (typeof e.timestamp !== "number") return false;

	// Validate kind-specific fields
	const validKinds = ["mount", "unmount", "change", "action-start", "action-end", "action-error"];
	if (!validKinds.includes(e.kind as string)) return false;

	if (e.kind === "action-start" || e.kind === "action-end" || e.kind === "action-error") {
		if (typeof e.actionId !== "string") return false;
		if (typeof e.actionName !== "string") return false;
	}

	return true;
}

describe("loggerBridge validation", () => {
	it("should validate action events with string actionId from mcpLogger", () => {
		const events = createMockActionEvents("testStore");

		for (const event of events) {
			const result = isValidEvent(event);
			assert.strictEqual(
				result,
				true,
				`Event with kind "${event.kind}" should be valid with string actionId`,
			);
		}
	});

	it("should reject action events with numeric actionId", () => {
		const invalidEvent = {
			kind: "action-start",
			storeName: "testStore",
			timestamp: Date.now(),
			actionId: 123, // number instead of string
			actionName: "testAction",
		};

		const result = isValidEvent(invalidEvent);
		assert.strictEqual(result, false, "Event with numeric actionId should be rejected");
	});

	it("should validate mount/unmount events", () => {
		const mountEvent = {
			kind: "mount",
			storeName: "testStore",
			timestamp: Date.now(),
		};

		const unmountEvent = {
			kind: "unmount",
			storeName: "testStore",
			timestamp: Date.now(),
		};

		assert.strictEqual(isValidEvent(mountEvent), true, "Mount event should be valid");
		assert.strictEqual(isValidEvent(unmountEvent), true, "Unmount event should be valid");
	});

	it("should validate change events", () => {
		const changeEvent = {
			kind: "change",
			storeName: "testStore",
			timestamp: Date.now(),
			valueMessage: "test value",
		};

		assert.strictEqual(isValidEvent(changeEvent), true, "Change event should be valid");
	});

	it("should reject events with missing required fields", () => {
		const invalidEvents = [
			{ kind: "mount", timestamp: Date.now() }, // missing storeName
			{ storeName: "test", timestamp: Date.now() }, // missing kind
			{ kind: "mount", storeName: "test" }, // missing timestamp
			{
				kind: "action-start",
				storeName: "test",
				timestamp: Date.now(),
				// missing actionId and actionName
			},
		];

		for (const event of invalidEvents) {
			assert.strictEqual(
				isValidEvent(event),
				false,
				`Event should be invalid: ${JSON.stringify(event)}`,
			);
		}
	});
});
