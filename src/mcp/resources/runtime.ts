import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerEventStore } from "../../domain/loggerEventStore.js";
import type { LoggerEventFilter, NanostoresLoggerEvent } from "../../domain/loggerTypes.js";

/**
 * Runtime events resource:
 *   nanostores://runtime/events
 *
 * Query parameters:
 *   - storeName: filter by store name
 *   - kind: filter by event kind (can be repeated)
 *   - since: timestamp filter (ms)
 *   - limit: max number of events (default 100)
 *   - actionName: filter by action name
 */
export function registerRuntimeEventsResource(
	server: McpServer,
	eventStore: LoggerEventStore,
): void {
	server.registerResource(
		"runtime-events",
		new ResourceTemplate("nanostores://runtime/events", {
			list: undefined,
		}),
		{
			title: "Nanostores runtime events",
			description:
				"Recent runtime events from @nanostores/logger integration. Supports filtering by store, kind, timestamp, and action name.",
		},
		async uri => {
			const url = new URL(uri.href);
			const params = url.searchParams;

			const filter: LoggerEventFilter = {
				storeName: params.get("storeName") || undefined,
				kinds: params.getAll("kind") as NanostoresLoggerEvent["kind"][],
				sinceTs: params.has("since") ? Number.parseInt(params.get("since")!, 10) : undefined,
				limit: params.has("limit") ? Number.parseInt(params.get("limit")!, 10) : 100,
				actionName: params.get("actionName") || undefined,
			};

			const events = eventStore.getEvents(filter);
			const stats = eventStore.getStats();

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							{
								filter,
								stats: {
									totalEvents: stats.totalEvents,
									sessionStartedAt: stats.sessionStartedAt,
									lastEventAt: stats.lastEventAt,
								},
								events,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

/**
 * Runtime statistics resource:
 *   nanostores://runtime/stats
 */
export function registerRuntimeStatsResource(
	server: McpServer,
	eventStore: LoggerEventStore,
): void {
	server.registerResource(
		"runtime-stats",
		new ResourceTemplate("nanostores://runtime/stats", {
			list: undefined,
		}),
		{
			title: "Nanostores runtime statistics",
			description:
				"Aggregated statistics for all stores: mount/unmount counts, change frequency, action metrics, error rates.",
		},
		async uri => {
			const stats = eventStore.getStats();
			const noisyStores = eventStore.getNoisyStores(10);
			const errorProneStores = eventStore.getErrorProneStores(1);

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							{
								summary: {
									totalStores: stats.stores.length,
									totalEvents: stats.totalEvents,
									sessionStartedAt: stats.sessionStartedAt,
									lastEventAt: stats.lastEventAt,
									sessionDuration: stats.lastEventAt - stats.sessionStartedAt,
								},
								topNoisyStores: noisyStores,
								errorProneStores,
								allStores: stats.stores,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}

/**
 * Runtime profile for a specific store:
 *   nanostores://runtime/store/{key}
 *
 * Key can be store name or store id
 */
export function registerRuntimeStoreResource(
	server: McpServer,
	eventStore: LoggerEventStore,
): void {
	server.registerResource(
		"runtime-store",
		new ResourceTemplate("nanostores://runtime/store/{key}", {
			list: undefined,
		}),
		{
			title: "Nanostores runtime store profile",
			description:
				"Runtime profile for a specific store: statistics + recent events. Can be addressed by store name or id.",
		},
		async (uri, { key }) => {
			// Try to extract store name from key
			// key can be either "$storeName", "storeName", or "store:path#$storeName"
			let storeName = key as string;

			if (storeName.startsWith("store:")) {
				// Extract from full id: "store:src/stores/cart.ts#$cartTotal" -> "$cartTotal"
				const hashIndex = storeName.indexOf("#");
				if (hashIndex !== -1) {
					storeName = storeName.slice(hashIndex + 1);
				}
			}

			// Remove $ prefix if present for matching
			const cleanStoreName = storeName.startsWith("$") ? storeName.slice(1) : storeName;

			// Try both with and without $ prefix
			let stats = eventStore.getStoreStats(`$${cleanStoreName}`);
			if (!stats) {
				stats = eventStore.getStoreStats(cleanStoreName);
			}

			if (!stats) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: `No runtime data found for store: ${key}\n\nThis store may not be instrumented with @nanostores/logger, or no events have been received yet.`,
						},
					],
				};
			}

			// Get recent events for this store
			const recentEvents = eventStore.getEvents({
				storeName: stats.storeName,
				limit: 50,
			});

			const profile = {
				storeName: stats.storeName,
				storeId: stats.storeId,
				stats,
				recentEvents,
				analysis: {
					isActive: stats.mounts > 0 && stats.unmounts < stats.mounts,
					changeRate: stats.changes / ((stats.lastSeen - stats.firstSeen) / 1000 || 1),
					errorRate: stats.actionsStarted > 0 ? stats.actionsErrored / stats.actionsStarted : 0,
				},
			};

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(profile, null, 2),
					},
				],
			};
		},
	);
}
