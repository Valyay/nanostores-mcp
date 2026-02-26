import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { NanostoresLoggerEvent } from "../../../src/domain/index.ts";

/**
 * Tests for the client-side MCP logger (src/client/mcpLogger.ts).
 *
 * Internal functions (formatValue, createBufferedSender, createEventFilter)
 * are module-private, so we replicate their logic here — same approach as
 * runtimeResources.test.ts.
 *
 * The public API (initMcpLogger, getMcpLogger, attachMcpLogger) is tested
 * via dynamic imports to handle the module-level singleton.
 */

// ============================================================================
// Replicated pure functions
// ============================================================================

/** Mirrors formatValue in mcpLogger.ts */
function formatValue(value: unknown): string {
	try {
		const str = JSON.stringify(value);
		return str.length > 200 ? str.slice(0, 200) + "…" : str;
	} catch {
		return String(value);
	}
}

/** Mirrors createBufferedSender */
function createBufferedSender(
	send: (events: NanostoresLoggerEvent[]) => Promise<void>,
	batchMs: number,
): { push: (event: NanostoresLoggerEvent) => void; flush: () => Promise<void> } {
	let buffer: NanostoresLoggerEvent[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = async (): Promise<void> => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (buffer.length === 0) return;
		const eventsToSend = [...buffer];
		buffer = [];
		await send(eventsToSend);
	};

	const scheduleFlush = (): void => {
		if (timer) return;
		timer = setTimeout(() => {
			void flush();
		}, batchMs);
	};

	const push = (event: NanostoresLoggerEvent): void => {
		buffer.push(event);
		scheduleFlush();
	};

	return { push, flush };
}

/** Mirrors createEventFilter */
function createEventFilter(
	maskEvent?: (event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null,
): (event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null {
	return (event: NanostoresLoggerEvent): NanostoresLoggerEvent | null => {
		return maskEvent ? maskEvent(event) : event;
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("formatValue", () => {
	it("serializes short values", () => {
		expect(formatValue(42)).toBe("42");
		expect(formatValue("hello")).toBe('"hello"');
		expect(formatValue(null)).toBe("null");
		expect(formatValue(true)).toBe("true");
		expect(formatValue({ a: 1 })).toBe('{"a":1}');
	});

	it("truncates values longer than 200 characters", () => {
		const longArray = Array.from({ length: 100 }, (_, i) => i);
		const result = formatValue(longArray);

		expect(result.length).toBeLessThanOrEqual(201); // 200 + "…"
		expect(result.endsWith("…")).toBe(true);
	});

	it("handles non-serializable objects gracefully", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		const result = formatValue(circular);
		expect(result).toBe("[object Object]");
	});

	it("returns short values untouched", () => {
		const result = formatValue([1, 2, 3]);
		expect(result).toBe("[1,2,3]");
		expect(result.endsWith("…")).toBe(false);
	});
});

describe("createBufferedSender", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("batches events and sends after batchMs", async () => {
		const sent: NanostoresLoggerEvent[][] = [];
		const send = async (events: NanostoresLoggerEvent[]): Promise<void> => {
			sent.push(events);
		};

		const { push } = createBufferedSender(send, 500);

		const event1: NanostoresLoggerEvent = { kind: "mount", storeName: "$a", timestamp: 1000 };
		const event2: NanostoresLoggerEvent = { kind: "mount", storeName: "$b", timestamp: 1001 };

		push(event1);
		push(event2);

		expect(sent).toHaveLength(0); // not sent yet

		await vi.advanceTimersByTimeAsync(500);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toHaveLength(2);
		expect(sent[0][0].storeName).toBe("$a");
		expect(sent[0][1].storeName).toBe("$b");
	});

	it("forceFlush clears timer and sends immediately", async () => {
		const sent: NanostoresLoggerEvent[][] = [];
		const send = async (events: NanostoresLoggerEvent[]): Promise<void> => {
			sent.push(events);
		};

		const { push, flush } = createBufferedSender(send, 5000);

		push({ kind: "mount", storeName: "$x", timestamp: 1000 });

		await flush();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toHaveLength(1);

		// Timer should be cleared — advancing time shouldn't trigger another send
		await vi.advanceTimersByTimeAsync(5000);
		expect(sent).toHaveLength(1);
	});

	it("forceFlush is a no-op when buffer is empty", async () => {
		const sent: NanostoresLoggerEvent[][] = [];
		const send = async (events: NanostoresLoggerEvent[]): Promise<void> => {
			sent.push(events);
		};

		const { flush } = createBufferedSender(send, 500);
		await flush();

		expect(sent).toHaveLength(0);
	});

	it("does not schedule multiple timers for consecutive pushes", async () => {
		const sent: NanostoresLoggerEvent[][] = [];
		const send = async (events: NanostoresLoggerEvent[]): Promise<void> => {
			sent.push(events);
		};

		const { push } = createBufferedSender(send, 200);

		push({ kind: "mount", storeName: "$a", timestamp: 1 });
		push({ kind: "mount", storeName: "$b", timestamp: 2 });
		push({ kind: "mount", storeName: "$c", timestamp: 3 });

		await vi.advanceTimersByTimeAsync(200);

		// All should be in a single batch
		expect(sent).toHaveLength(1);
		expect(sent[0]).toHaveLength(3);
	});
});

describe("createEventFilter", () => {
	it("passes events through when no mask provided", () => {
		const filter = createEventFilter();
		const event: NanostoresLoggerEvent = { kind: "mount", storeName: "$a", timestamp: 1 };

		expect(filter(event)).toBe(event);
	});

	it("applies mask function and returns transformed event", () => {
		const mask = (event: NanostoresLoggerEvent): NanostoresLoggerEvent => ({
			...event,
			storeName: "[redacted]",
		});
		const filter = createEventFilter(mask);
		const event: NanostoresLoggerEvent = { kind: "mount", storeName: "$secret", timestamp: 1 };

		const result = filter(event);
		expect(result!.storeName).toBe("[redacted]");
	});

	it("returns null when mask returns null (skip event)", () => {
		const mask = (event: NanostoresLoggerEvent): NanostoresLoggerEvent | null => {
			if (event.storeName === "$secret") return null;
			return event;
		};
		const filter = createEventFilter(mask);

		expect(filter({ kind: "mount", storeName: "$secret", timestamp: 1 })).toBeNull();
		expect(filter({ kind: "mount", storeName: "$ok", timestamp: 1 })).not.toBeNull();
	});
});

describe("action ID tracking logic", () => {
	it("tracks active action IDs and ignores orphan actionEnd", () => {
		const activeActionIds = new Set<string>();
		const pushed: NanostoresLoggerEvent[] = [];
		const pushEvent = (event: NanostoresLoggerEvent): void => {
			pushed.push(event);
		};

		// Simulate actionStart
		const actionId = "test-id-1";
		activeActionIds.add(actionId);
		pushEvent({
			kind: "action-start",
			storeName: "$cart",
			timestamp: 1,
			actionId,
			actionName: "addItem",
		});

		// Simulate actionEnd with valid ID
		if (activeActionIds.has(actionId)) {
			activeActionIds.delete(actionId);
			pushEvent({
				kind: "action-end",
				storeName: "$cart",
				timestamp: 2,
				actionId,
			});
		}

		// Simulate orphan actionEnd (ID not in active set)
		const orphanId = "orphan-id";
		if (activeActionIds.has(orphanId)) {
			pushEvent({
				kind: "action-end",
				storeName: "$cart",
				timestamp: 3,
				actionId: orphanId,
			});
		}

		expect(pushed).toHaveLength(2);
		expect(pushed[0].kind).toBe("action-start");
		expect(pushed[1].kind).toBe("action-end");
	});

	it("handles duplicate actionEnd for same ID", () => {
		const activeActionIds = new Set<string>();
		const pushed: NanostoresLoggerEvent[] = [];
		const pushEvent = (event: NanostoresLoggerEvent): void => {
			pushed.push(event);
		};

		const actionId = "dup-id";
		activeActionIds.add(actionId);

		// First actionEnd — valid
		if (activeActionIds.has(actionId)) {
			activeActionIds.delete(actionId);
			pushEvent({
				kind: "action-end",
				storeName: "$cart",
				timestamp: 1,
				actionId,
			});
		}

		// Second actionEnd — should be ignored
		if (activeActionIds.has(actionId)) {
			activeActionIds.delete(actionId);
			pushEvent({
				kind: "action-end",
				storeName: "$cart",
				timestamp: 2,
				actionId,
			});
		}

		expect(pushed).toHaveLength(1);
	});

	it("handles actionError which also removes the ID", () => {
		const activeActionIds = new Set<string>();
		const pushed: NanostoresLoggerEvent[] = [];
		const pushEvent = (event: NanostoresLoggerEvent): void => {
			pushed.push(event);
		};

		const actionId = "err-id";
		activeActionIds.add(actionId);

		// actionError removes the ID
		if (activeActionIds.has(actionId)) {
			activeActionIds.delete(actionId);
			pushEvent({
				kind: "action-error",
				storeName: "$cart",
				timestamp: 1,
				actionId,
				errorMessage: "fail",
			});
		}

		// Subsequent actionEnd should be ignored
		if (activeActionIds.has(actionId)) {
			pushEvent({
				kind: "action-end",
				storeName: "$cart",
				timestamp: 2,
				actionId,
			});
		}

		expect(pushed).toHaveLength(1);
		expect(pushed[0].kind).toBe("action-error");
	});
});

describe("initMcpLogger / getMcpLogger public API", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("getMcpLogger returns null before init", async () => {
		const mod = await import("../../../src/client/mcpLogger.ts");
		expect(mod.getMcpLogger()).toBeNull();
	});

	it("initMcpLogger creates a singleton client when enabled", async () => {
		const mod = await import("../../../src/client/mcpLogger.ts");
		mod.initMcpLogger({ enabled: true });

		const logger = mod.getMcpLogger();
		expect(logger).not.toBeNull();
		expect(typeof logger!.handlersFor).toBe("function");
		expect(typeof logger!.forceFlush).toBe("function");
	});

	it("initMcpLogger does not create client when explicitly disabled", async () => {
		const mod = await import("../../../src/client/mcpLogger.ts");
		mod.initMcpLogger({ enabled: false });
		expect(mod.getMcpLogger()).toBeNull();
	});

	it("initMcpLogger preserves singleton on second call", async () => {
		const mod = await import("../../../src/client/mcpLogger.ts");
		mod.initMcpLogger({ enabled: true });
		const first = mod.getMcpLogger();

		mod.initMcpLogger({ enabled: true });
		const second = mod.getMcpLogger();

		expect(first).toBe(second);
	});

	it("attachMcpLogger returns no-op when logger not initialized", async () => {
		const mod = await import("../../../src/client/mcpLogger.ts");
		// Don't init
		const cleanup = mod.attachMcpLogger({} as never, "$test");
		expect(typeof cleanup).toBe("function");
		// Should not throw
		cleanup();
	});
});
