import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	RuntimeAnalysisService,
	LoggerEventFilter,
	NanostoresLoggerEvent,
} from "../../domain/index.js";
import { URIS } from "../uris.js";

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
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerResource(
		"runtime-events",
		new ResourceTemplate(URIS.runtimeEvents, {
			list: async (): Promise<{
				resources: {
					name: string;
					uri: string;
					description: string;
					mimeType: string;
				}[];
			}> => {
				const summary = runtimeService.getStats();
				return {
					resources: summary.stores.map(store => ({
						name: store.storeName,
						uri: URIS.storeById(store.storeId ?? store.storeName),
						description: `changes: ${store.changes}, errors: ${store.actionsErrored}`,
						mimeType: "application/json",
					})),
				};
			},
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

			const events = runtimeService.getEvents(filter);
			const stats = runtimeService.getStats();

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
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerResource(
		"runtime-stats",
		new ResourceTemplate(URIS.runtimeStats, {
			list: undefined,
		}),
		{
			title: "Nanostores runtime statistics",
			description:
				"Aggregated statistics for all stores: mount/unmount counts, change frequency, action metrics, error rates.",
		},
		async uri => {
			const stats = runtimeService.getStats();
			const noisyStores = runtimeService.getNoisyStores(10);
			const errorProneStores = runtimeService.getErrorProneStores(1);

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
 * Query parameters:
 *   - projectRoot: optional project root to link with static analysis
 */
export function registerRuntimeStoreResource(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerResource(
		"runtime-store",
		new ResourceTemplate(URIS.runtimeStoreTemplate, {
			list: undefined,
		}),
		{
			title: "Nanostores runtime store profile",
			description:
				"Runtime profile combining static analysis with runtime data: statistics, recent events, and store metadata (file, type, relations). If projectRoot is provided, static data is automatically merged.",
		},
		async (uri, { key }) => {
			// Extract projectRoot from query params
			const url = new URL(uri.href);
			const projectRoot = url.searchParams.get("projectRoot") || undefined;

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

			// Try both with and without $ prefix, pass projectRoot for static data linking
			let profile = await runtimeService.getStoreProfile(`$${cleanStoreName}`, projectRoot);
			if (!profile) {
				profile = await runtimeService.getStoreProfile(cleanStoreName, projectRoot);
			}

			if (!profile) {
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

			// Add metadata about data sources
			const hasStaticData = !!(profile.id || profile.kind || profile.file);
			const metadata = {
				_meta: {
					dataSources: {
						runtime: true,
						static: hasStaticData,
						projectRoot: profile.projectRoot || projectRoot || null,
					},
					note: hasStaticData
						? "This profile combines static AST analysis with runtime logger data"
						: "This profile contains only runtime data. Static analysis is unavailable (missing projectRoot or store not found in project scan)",
				},
			};

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify({ ...metadata, ...profile }, null, 2),
					},
				],
			};
		},
	);
}
