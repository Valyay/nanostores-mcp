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

describe("createEventSender: error visibility", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	/** Mirrors createEventSender with warn-throttle logic */
	function createEventSender(
		url: string,
		fetchFn: typeof fetch,
	): (events: NanostoresLoggerEvent[]) => Promise<void> {
		let lastWarnedAt = 0;
		const WARN_THROTTLE_MS = 10_000;

		return async (events: NanostoresLoggerEvent[]): Promise<void> => {
			try {
				const response = await fetchFn(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ events }),
				});
				if (!response.ok) {
					warnThrottled(
						`[nanostores-mcp] Logger bridge returned ${response.status}: ${response.statusText}`,
					);
				}
			} catch (err) {
				warnThrottled(
					`[nanostores-mcp] Cannot reach logger bridge at ${url}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			function warnThrottled(msg: string): void {
				const now = Date.now();
				if (now - lastWarnedAt < WARN_THROTTLE_MS) return;
				lastWarnedAt = now;
				console.warn(msg);
			}
		};
	}

	it("warns on network error", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("Connection refused"));
		const send = createEventSender("http://127.0.0.1:3999/nanostores-logger", fetchFn);

		await send([{ kind: "mount", storeName: "$a", timestamp: 1 }]);

		expect(console.warn).toHaveBeenCalledOnce();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining("Cannot reach logger bridge"),
		);
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Connection refused"));
	});

	it("warns on non-ok HTTP response", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 413, statusText: "Payload Too Large" });
		const send = createEventSender("http://127.0.0.1:3999/nanostores-logger", fetchFn);

		await send([{ kind: "mount", storeName: "$a", timestamp: 1 }]);

		expect(console.warn).toHaveBeenCalledOnce();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining("Logger bridge returned 413"),
		);
	});

	it("does not warn on successful response", async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		const send = createEventSender("http://127.0.0.1:3999/nanostores-logger", fetchFn);

		await send([{ kind: "mount", storeName: "$a", timestamp: 1 }]);

		expect(console.warn).not.toHaveBeenCalled();
	});

	it("throttles repeated warnings to 1 per 10 seconds", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("Connection refused"));
		const send = createEventSender("http://127.0.0.1:3999/nanostores-logger", fetchFn);

		// First call — warns
		await send([{ kind: "mount", storeName: "$a", timestamp: 1 }]);
		expect(console.warn).toHaveBeenCalledTimes(1);

		// Second call within 10s — throttled
		vi.advanceTimersByTime(5_000);
		await send([{ kind: "mount", storeName: "$b", timestamp: 2 }]);
		expect(console.warn).toHaveBeenCalledTimes(1);

		// After 10s — warns again
		vi.advanceTimersByTime(5_001);
		await send([{ kind: "mount", storeName: "$c", timestamp: 3 }]);
		expect(console.warn).toHaveBeenCalledTimes(2);
	});

	it("does not throw — errors are swallowed after warning", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("boom"));
		const send = createEventSender("http://127.0.0.1:3999/nanostores-logger", fetchFn);

		// Must not throw
		await expect(send([{ kind: "mount", storeName: "$a", timestamp: 1 }])).resolves.toBeUndefined();
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

describe("action() compatibility with buildLogger", () => {
	it("captures action-start, action-end events via buildLogger action handlers", async () => {
		const { atom } = await import("nanostores");
		const { action } = await import("@nanostores/logger");

		const events: NanostoresLoggerEvent[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

		const mod = await import("../../../src/client/mcpLogger.ts");
		mod.initMcpLogger({ enabled: true, batchMs: 50 });

		const $store = atom(0);
		const increment = action($store, "increment", ($s, amount: number) => {
			$s.set($s.get() + amount);
			return $s.get();
		});

		mod.attachMcpLogger($store, "$testAction");

		// Subscribe to activate the store
		const unsub = $store.subscribe(() => {});

		// Call the action
		const result = increment(5);
		expect(result).toBe(5);

		// Wait for batch flush
		await new Promise(r => setTimeout(r, 100));

		// Check captured events
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		const calls = fetchMock.mock.calls;

		const allEvents: NanostoresLoggerEvent[] = [];
		for (const call of calls) {
			const body = JSON.parse(call[1]?.body as string);
			allEvents.push(...body.events);
		}

		const actionStarts = allEvents.filter(e => e.kind === "action-start" && e.storeName === "$testAction");
		const actionEnds = allEvents.filter(e => e.kind === "action-end" && e.storeName === "$testAction");

		expect(actionStarts.length).toBeGreaterThanOrEqual(1);
		expect(actionEnds.length).toBeGreaterThanOrEqual(1);
		expect(actionStarts[0].actionName).toBe("increment");
		expect(actionEnds[0].actionName).toBe("increment");
		// actionId should be a string (converted from number)
		expect(typeof actionStarts[0].actionId).toBe("string");
		expect(actionStarts[0].actionId).toBe(actionEnds[0].actionId);

		unsub();
		globalThis.fetch = originalFetch;
	});

	it("captures action-error events for failed async actions", async () => {
		const { atom } = await import("nanostores");
		const { action } = await import("@nanostores/logger");

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

		const mod = await import("../../../src/client/mcpLogger.ts");
		mod.initMcpLogger({ enabled: true, batchMs: 50 });

		const $store = atom(0);
		const failingAction = action($store, "failAction", async () => {
			throw new Error("test failure");
		});

		mod.attachMcpLogger($store, "$testError");
		const unsub = $store.subscribe(() => {});

		try {
			await failingAction();
		} catch {
			// expected
		}

		await new Promise(r => setTimeout(r, 100));

		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		const allEvents: NanostoresLoggerEvent[] = [];
		for (const call of fetchMock.mock.calls) {
			const body = JSON.parse(call[1]?.body as string);
			allEvents.push(...body.events);
		}

		const actionErrors = allEvents.filter(e => e.kind === "action-error" && e.storeName === "$testError");
		expect(actionErrors.length).toBeGreaterThanOrEqual(1);
		expect(actionErrors[0].actionName).toBe("failAction");
		expect(actionErrors[0].errorMessage).toBe("test failure");

		unsub();
		globalThis.fetch = originalFetch;
	});
});
