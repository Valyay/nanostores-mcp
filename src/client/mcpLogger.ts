import { buildLogger } from "@nanostores/logger";
import type { AnyStore } from "nanostores";
import { nanoid } from "nanoid";
import type { NanostoresLoggerEvent } from "../domain/index.js";

export interface McpLoggerClientOptions {
	url?: string;
	batchMs?: number;
	enabled?: boolean;
	/** workspace root to link runtime events with static analysis */
	projectRoot?: string; 
	maskEvent?: (event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null;
}

export interface LoggerHandlers {
	mount: () => void;
	unmount: () => void;
	change: (value: unknown) => void;
	actionStart: (actionName: string) => string;
	actionEnd: (actionId: string) => void;
	actionError: (actionId: string, error: unknown) => void;
}

interface McpLoggerClient {
	handlersFor: (storeName: string) => LoggerHandlers;
	forceFlush: () => Promise<void>;
}

// Pure function for formatting value to string
const formatValue = (value: unknown): string => {
	try {
		const str = JSON.stringify(value);
		return str.length > 200 ? str.slice(0, 200) + "…" : str;
	} catch {
		return String(value);
	}
};

// Factory for creating event sending function
const createEventSender = (url: string) => {
	return async (events: NanostoresLoggerEvent[]): Promise<void> => {
		try {
			await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ events }),
			});
		} catch {
			// Silently ignore sending errors to avoid breaking the main application
		}
	};
};

// Factory for creating buffered sender
const createBufferedSender = (
	send: (events: NanostoresLoggerEvent[]) => Promise<void>,
	batchMs: number,
): { push: (event: NanostoresLoggerEvent) => void; flush: () => Promise<void> } => {
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
};

// Factory for creating event filter
const createEventFilter = (
	maskEvent?: (event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null,
): ((event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null) => {
	return (event: NanostoresLoggerEvent): NanostoresLoggerEvent | null => {
		return maskEvent ? maskEvent(event) : event;
	};
};

// Main factory function for client
function createMcpLoggerClient(options: McpLoggerClientOptions = {}): McpLoggerClient {
	const url = options.url ?? "http://127.0.0.1:3999/nanostores-logger";
	const batchMs = options.batchMs ?? 1000;
	const projectRoot = options.projectRoot;

	// Function composition
	const sendEvents = createEventSender(url);
	const { push: pushToBuffer, flush } = createBufferedSender(sendEvents, batchMs);
	const filterEvent = createEventFilter(options.maskEvent);

	// State for tracking active actions
	const activeActionIds = new Set<string>();

	// Pure function for adding event
	const pushEvent = (event: NanostoresLoggerEvent): void => {
		const filtered = filterEvent(event);
		if (filtered) pushToBuffer(filtered);
	};

	// Factory for handlers for specific store
	const handlersFor = (storeName: string): LoggerHandlers => ({
		mount: (): void => {
			pushEvent({
				kind: "mount",
				storeName,
				timestamp: Date.now(),
				projectRoot,
			});
		},

		unmount: (): void => {
			pushEvent({
				kind: "unmount",
				storeName,
				timestamp: Date.now(),
				projectRoot,
			});
		},

		change: (value: unknown): void => {
			pushEvent({
				kind: "change",
				storeName,
				timestamp: Date.now(),
				valueMessage: formatValue(value),
				projectRoot,
			});
		},

		actionStart: (actionName: string): string => {
			const actionId = nanoid();
			activeActionIds.add(actionId);

			pushEvent({
				kind: "action-start",
				storeName,
				timestamp: Date.now(),
				actionId,
				actionName,
				projectRoot,
			});

			return actionId;
		},

		actionEnd: (actionId: string): void => {
			if (!activeActionIds.has(actionId)) return;
			activeActionIds.delete(actionId);

			pushEvent({
				kind: "action-end",
				storeName,
				timestamp: Date.now(),
				actionId,
				projectRoot,
			});
		},

		actionError: (actionId: string, error: unknown): void => {
			if (!activeActionIds.has(actionId)) return;
			activeActionIds.delete(actionId);

			pushEvent({
				kind: "action-error",
				storeName,
				timestamp: Date.now(),
				actionId,
				errorMessage: error instanceof Error ? error.message : String(error),
				projectRoot,
			});
		},
	});

	return {
		handlersFor,
		forceFlush: flush,
	};
}

let mcpLogger: McpLoggerClient | null = null;

/**
 * Initializes global MCP Logger client.
 * By default, works only in dev mode (NODE_ENV !== "production").
 *
 * @example
 * ```ts
 * import { initMcpLogger } from "nanostores-mcp/mcpLogger";
 *
 * initMcpLogger({
 *   url: "http://localhost:3999/nanostores-logger",
 *   batchMs: 1000,
 *   maskEvent: (event) => {
 *     // Hide sensitive data
 *     if (event.storeName === "authStore") return null;
 *     return event;
 *   }
 * });
 * ```
 */
export function initMcpLogger(options: McpLoggerClientOptions = {}): void {
	// dev-only enablement by default
	const enabled =
		options.enabled ??
		(typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) ??
		process.env.NODE_ENV !== "production";

	if (!enabled) return;

	if (!mcpLogger) {
		mcpLogger = createMcpLoggerClient(options);
	}
}

/**
 * Attaches MCP Logger to specified Nanostores store.
 * Must be called after `initMcpLogger()`.
 *
 * @param store - Nanostores store (atom, map, computed, etc.)
 * @param storeName - Store name for identification in logs
 * @returns Logger detach function (cleanup)
 *
 * @example
 * ```ts
 * import { atom } from "nanostores";
 * import { attachMcpLogger } from "nanostores-mcp/mcpLogger";
 *
 * const $counter = atom(0);
 * const unbind = attachMcpLogger($counter, "counter");
 *
 * // Later, on unmount:
 * unbind();
 * ```
 */
export function attachMcpLogger(store: AnyStore, storeName: string): () => void {
	if (!mcpLogger) return (): void => {};
	return buildLogger(store, storeName, mcpLogger.handlersFor(storeName));
}

/**
 * Get access to global client instance for manual control.
 * Useful for calling `forceFlush()` before application shutdown.
 *
 * @example
 * ```ts
 * import { getMcpLogger } from "nanostores-mcp/mcpLogger";
 *
 * window.addEventListener("beforeunload", async () => {
 *   const logger = getMcpLogger();
 *   await logger?.forceFlush();
 * });
 * ```
 */
export function getMcpLogger(): McpLoggerClient | null {
	return mcpLogger;
}
