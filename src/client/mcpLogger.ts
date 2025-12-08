import { buildLogger } from "@nanostores/logger";
import type { AnyStore } from "nanostores";
import { nanoid } from "nanoid";

export interface NanostoresLoggerEvent {
	kind: "mount" | "unmount" | "change" | "action-start" | "action-end" | "action-error";
	storeName: string;
	timestamp: number;
	[key: string]: unknown;
}

export interface McpLoggerClientOptions {
	url?: string;
	batchMs?: number;
	enabled?: boolean;
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

// Чистая функция для форматирования значения в строку
const formatValue = (value: unknown): string => {
	try {
		const str = JSON.stringify(value);
		return str.length > 200 ? str.slice(0, 200) + "…" : str;
	} catch {
		return String(value);
	}
};

// Фабрика для создания функции отправки событий
const createEventSender = (url: string) => {
	return async (events: NanostoresLoggerEvent[]): Promise<void> => {
		try {
			await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ events }),
			});
		} catch {
			// Тихо игнорируем ошибки отправки, чтобы не ломать основное приложение
		}
	};
};

// Фабрика для создания буферизованного отправителя
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

// Фабрика для создания фильтра событий
const createEventFilter = (
	maskEvent?: (event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null,
): ((event: NanostoresLoggerEvent) => NanostoresLoggerEvent | null) => {
	return (event: NanostoresLoggerEvent): NanostoresLoggerEvent | null => {
		return maskEvent ? maskEvent(event) : event;
	};
};

// Главная фабричная функция клиента
function createMcpLoggerClient(options: McpLoggerClientOptions = {}): McpLoggerClient {
	const url = options.url ?? "http://127.0.0.1:3999/nanostores-logger";
	const batchMs = options.batchMs ?? 1000;

	// Композиция функций
	const sendEvents = createEventSender(url);
	const { push: pushToBuffer, flush } = createBufferedSender(sendEvents, batchMs);
	const filterEvent = createEventFilter(options.maskEvent);

	// Состояние для отслеживания активных экшенов
	const activeActionIds = new Set<string>();

	// Чистая функция для добавления события
	const pushEvent = (event: NanostoresLoggerEvent): void => {
		const filtered = filterEvent(event);
		if (filtered) pushToBuffer(filtered);
	};

	// Фабрика хендлеров для конкретного store
	const handlersFor = (storeName: string): LoggerHandlers => ({
		mount: (): void => {
			pushEvent({
				kind: "mount",
				storeName,
				timestamp: Date.now(),
			});
		},

		unmount: (): void => {
			pushEvent({
				kind: "unmount",
				storeName,
				timestamp: Date.now(),
			});
		},

		change: (value: unknown): void => {
			pushEvent({
				kind: "change",
				storeName,
				timestamp: Date.now(),
				valueMessage: formatValue(value),
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
 * Инициализирует глобальный клиент MCP Logger.
 * По умолчанию работает только в dev-режиме (NODE_ENV !== "production").
 *
 * @example
 * ```ts
 * import { initMcpLogger } from "nanostores-mcp/mcpLogger";
 *
 * initMcpLogger({
 *   url: "http://localhost:3999/nanostores-logger",
 *   batchMs: 1000,
 *   maskEvent: (event) => {
 *     // Скрываем чувствительные данные
 *     if (event.storeName === "authStore") return null;
 *     return event;
 *   }
 * });
 * ```
 */
export function initMcpLogger(options: McpLoggerClientOptions = {}): void {
	// dev-only включение по умолчанию
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
 * Подключает MCP Logger к указанному Nanostores-хранилищу.
 * Должен быть вызван после `initMcpLogger()`.
 *
 * @param store - Nanostores-хранилище (atom, map, computed и т.д.)
 * @param storeName - Имя хранилища для идентификации в логах
 * @returns Функция отключения логгера (cleanup)
 *
 * @example
 * ```ts
 * import { atom } from "nanostores";
 * import { attachMcpLogger } from "nanostores-mcp/mcpLogger";
 *
 * const $counter = atom(0);
 * const unbind = attachMcpLogger($counter, "counter");
 *
 * // Позже, при размонтировании:
 * unbind();
 * ```
 */
export function attachMcpLogger(store: AnyStore, storeName: string): () => void {
	if (!mcpLogger) return (): void => {};
	return buildLogger(store, storeName, mcpLogger.handlersFor(storeName));
}

/**
 * Получить доступ к глобальному экземпляру клиента для ручного управления.
 * Полезно для вызова `forceFlush()` перед закрытием приложения.
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
