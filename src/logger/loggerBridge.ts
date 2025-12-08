import http from "node:http";
import type { LoggerEventStore, NanostoresLoggerEvent } from "../domain/index.js";

interface LoggerBridgeConfig {
	host: string;
	port: number;
	enabled: boolean;
	maxPayloadSize: number; // bytes
}

interface IncomingEventPayload {
	events: unknown[];
}

/**
 * Logger bridge server interface
 */
export interface LoggerBridgeServer {
	start(): Promise<void>;
	stop(): Promise<void>;
	getInfo(): { enabled: boolean; url?: string };
}

/**
 * Internal state for logger bridge
 */
interface LoggerBridgeState {
	server: http.Server | null;
	config: LoggerBridgeConfig;
	eventStore: LoggerEventStore;
}

/**
 * Basic validation for event structure
 */
function isValidEvent(event: unknown): event is NanostoresLoggerEvent {
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
		if (typeof e.actionId !== "number") return false;
		if (typeof e.actionName !== "string") return false;
	}

	return true;
}

/**
 * Validate and sanitize incoming events
 */
function validateEvents(events: unknown[]): NanostoresLoggerEvent[] {
	const validated: NanostoresLoggerEvent[] = [];

	for (const event of events) {
		if (!isValidEvent(event)) {
			continue;
		}
		validated.push(event as NanostoresLoggerEvent);
	}

	return validated;
}

/**
 * Handle POST /nanostores-logger
 */
function handleLoggerEvents(
	state: LoggerBridgeState,
	req: http.IncomingMessage,
	res: http.ServerResponse,
): void {
	let body = "";
	let bytesReceived = 0;

	req.on("data", chunk => {
		bytesReceived += chunk.length;
		if (bytesReceived > state.config.maxPayloadSize) {
			res.writeHead(413, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Payload too large" }));
			req.destroy();
			return;
		}
		body += chunk.toString();
	});

	req.on("end", () => {
		try {
			const payload = JSON.parse(body) as IncomingEventPayload;

			if (!Array.isArray(payload.events)) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid payload: events must be array" }));
				return;
			}

			// Validate and add events
			const validEvents = validateEvents(payload.events);
			state.eventStore.addMany(validEvents);

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					success: true,
					received: validEvents.length,
				}),
			);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error: "Invalid JSON",
				}),
			);
		}
	});

	req.on("error", () => {
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Internal server error" }));
	});
}

/**
 * Handle incoming HTTP request
 */
function handleRequest(
	state: LoggerBridgeState,
	req: http.IncomingMessage,
	res: http.ServerResponse,
): void {
	// CORS headers for local development
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}

	if (req.method !== "POST") {
		res.writeHead(405, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Method not allowed" }));
		return;
	}

	if (req.url !== "/nanostores-logger") {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
		return;
	}

	handleLoggerEvents(state, req, res);
}

/**
 * Create logger bridge server instance
 * HTTP bridge server for receiving logger events from client applications
 * Listens only on localhost for security
 */
export function createLoggerBridge(
	eventStore: LoggerEventStore,
	config: Partial<LoggerBridgeConfig> = {},
): LoggerBridgeServer {
	const fullConfig: LoggerBridgeConfig = {
		host: config.host || "127.0.0.1",
		port: config.port || 3999,
		enabled: config.enabled ?? true,
		maxPayloadSize: config.maxPayloadSize || 1024 * 1024, // 1MB
	};

	const state: LoggerBridgeState = {
		server: null,
		config: fullConfig,
		eventStore,
	};

	return {
		/**
		 * Start the HTTP server
		 */
		start(): Promise<void> {
			if (!state.config.enabled) {
				return Promise.resolve();
			}

			return new Promise((resolve, reject) => {
				state.server = http.createServer((req, res) => {
					handleRequest(state, req, res);
				});

				state.server.on("error", (err: NodeJS.ErrnoException) => {
					reject(err);
				});

				state.server.listen(state.config.port, state.config.host, () => {
					resolve();
				});
			});
		},

		/**
		 * Stop the HTTP server
		 */
		stop(): Promise<void> {
			if (!state.server) {
				return Promise.resolve();
			}

			return new Promise((resolve, reject) => {
				state.server!.close(err => {
					if (err) {
						reject(err);
					} else {
						state.server = null;
						resolve();
					}
				});
			});
		},

		/**
		 * Get connection info
		 */
		getInfo(): { enabled: boolean; url?: string } {
			if (!state.config.enabled || !state.server) {
				return { enabled: false };
			}
			return {
				enabled: true,
				url: `http://${state.config.host}:${state.config.port}`,
			};
		},
	};
}
