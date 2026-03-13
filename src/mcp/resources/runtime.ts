import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	RuntimeAnalysisService,
	LoggerEventFilter,
	NanostoresLoggerEvent,
} from "../../domain/index.js";
import { RUNTIME_STATIC_UNAVAILABLE_MESSAGE } from "../shared/consts.js";
import { URIS } from "../uris.js";

export function parseEventsFilter(searchParams: URLSearchParams): LoggerEventFilter {
	return {
		storeName: searchParams.get("storeName") || undefined,
		kinds:
			searchParams.getAll("kind").length > 0
				? (searchParams.getAll("kind") as NanostoresLoggerEvent["kind"][])
				: undefined,
		sinceTs: searchParams.has("since")
			? Number.parseInt(searchParams.get("since")!, 10)
			: undefined,
		limit: searchParams.has("limit") ? Number.parseInt(searchParams.get("limit")!, 10) : 100,
		actionName: searchParams.get("actionName") || undefined,
	};
}

export function normalizeStoreKey(key: string): { cleanStoreName: string; candidates: string[] } {
	let storeName = key;

	if (storeName.startsWith("store:")) {
		const hashIndex = storeName.indexOf("#");
		if (hashIndex !== -1) {
			storeName = storeName.slice(hashIndex + 1);
		} else {
			return { cleanStoreName: storeName, candidates: [storeName] };
		}
	}

	const cleanStoreName = storeName.startsWith("$") ? storeName.slice(1) : storeName;

	return {
		cleanStoreName,
		candidates: [`$${cleanStoreName}`, cleanStoreName],
	};
}

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
			const filter = parseEventsFilter(url.searchParams);

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

			const { candidates } = normalizeStoreKey(key as string);

			// Try both with and without $ prefix, pass projectRoot for static data linking
			let profile = await runtimeService.getStoreProfile(candidates[0], projectRoot);
			if (!profile && candidates[1]) {
				profile = await runtimeService.getStoreProfile(candidates[1], projectRoot);
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
						: RUNTIME_STATIC_UNAVAILABLE_MESSAGE,
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
