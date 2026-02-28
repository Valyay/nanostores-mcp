import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	RuntimeAnalysisService,
	LoggerEventFilter,
	NanostoresLoggerEvent,
	StoreRuntimeStats,
} from "../../domain/index.js";
import { toToon } from "../../shared/toon.js";
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

function getStoreEventCount(store: StoreRuntimeStats): number {
	return (
		store.mounts +
		store.unmounts +
		store.changes +
		store.actionsStarted +
		store.actionsCompleted +
		store.actionsErrored
	);
}

function getLastChangeMsAgo(store: StoreRuntimeStats, now: number): number | undefined {
	if (!store.lastChange) return undefined;
	return Math.max(0, now - store.lastChange.timestamp);
}

function pickExampleEventType(store: StoreRuntimeStats): string | undefined {
	if (store.changes > 0) return "change";
	if (store.actionsErrored > 0) return "action-error";
	if (store.actionsStarted > 0) return "action-start";
	if (store.mounts > 0) return "mount";
	if (store.unmounts > 0) return "unmount";
	return undefined;
}

function computeMaxChangesPerSecond(events: NanostoresLoggerEvent[]): number | undefined {
	const timestamps = events
		.filter(event => event.kind === "change")
		.map(event => event.timestamp)
		.sort((a, b) => a - b);

	if (timestamps.length === 0) return undefined;

	let max = 1;
	let start = 0;

	for (let end = 0; end < timestamps.length; end++) {
		while (timestamps[end] - timestamps[start] > 1000) {
			start += 1;
		}
		const count = end - start + 1;
		if (count > max) {
			max = count;
		}
	}

	return max;
}

async function buildStaticHints(
	runtimeService: RuntimeAnalysisService,
	stores: StoreRuntimeStats[],
): Promise<Map<string, { id?: string; kind?: string; file?: string }>> {
	const entries = await Promise.all(
		stores.map(async store => {
			if (!store.projectRoot) {
				return [store.storeName, {}] as const;
			}
			const profile = await runtimeService.getStoreProfile(store.storeName, store.projectRoot);
			return [
				store.storeName,
				{
					id: profile?.id,
					kind: profile?.kind,
					file: profile?.file,
				},
			] as const;
		}),
	);

	return new Map(entries);
}

/**
 * Runtime overview resource:
 *   nanostores://runtime/overview
 */
export function registerRuntimeOverviewResource(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerResource(
		"runtime-overview",
		URIS.runtimeOverview,
		{
			title: "Nanostores runtime overview",
			description: "Aggregated runtime health summary: totals, noisy stores, and inactive stores.",
		},
		async uri => {
			const stats = runtimeService.getStats();
			const hasRuntimeData = stats.stores.length > 0 || stats.totalEvents > 0;

			if (!hasRuntimeData) {
				const empty = {
					hasRuntimeData: false,
					totals: {
						storesSeen: 0,
						events: 0,
						errors: 0,
					},
					noisyStores: [],
					inactiveStores: [],
				};

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(empty),
						},
					],
					structuredContent: empty,
				};
			}

			const now = Date.now();
			const totalErrors = stats.stores.reduce((sum, store) => sum + store.actionsErrored, 0);

			const noisyStores = [...stats.stores]
				.sort(
					(a, b) =>
						b.changes - a.changes ||
						b.actionsStarted - a.actionsStarted ||
						a.storeName.localeCompare(b.storeName),
				)
				.slice(0, 10)
				.map(store => ({
					storeId: store.storeId ?? store.storeName,
					name: store.storeName,
					changes: store.changes,
					mounts: store.mounts,
					errors: store.actionsErrored,
					lastChangeMsAgo: getLastChangeMsAgo(store, now),
				}));

			const inactiveStores = stats.stores
				.filter(store => store.mounts === 0 || store.changes === 0)
				.sort(
					(a, b) =>
						a.mounts - b.mounts || a.changes - b.changes || a.storeName.localeCompare(b.storeName),
				)
				.slice(0, 10)
				.map(store => ({
					storeId: store.storeId ?? store.storeName,
					name: store.storeName,
					mounts: store.mounts,
					changes: store.changes,
					reason:
						store.mounts === 0 ? "neverMounted" : store.changes === 0 ? "noChanges" : "unknown",
				}));

			const overview = {
				hasRuntimeData: true,
				totals: {
					storesSeen: stats.stores.length,
					events: stats.totalEvents,
					errors: totalErrors,
				},
				noisyStores,
				inactiveStores,
			};

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(overview),
					},
				],
				structuredContent: overview,
			};
		},
	);
}

/**
 * Runtime stats in TOON:
 *   nanostores://runtime/stats-toon
 */
export function registerRuntimeStatsToonResource(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerResource(
		"runtime-stats-toon",
		URIS.runtimeStatsToon,
		{
			title: "Nanostores runtime stats (TOON)",
			description:
				"Runtime store metrics encoded as TOON for compact representation of large tables.",
		},
		async uri => {
			const stats = runtimeService.getStats();
			const now = Date.now();
			const staticHints = await buildStaticHints(runtimeService, stats.stores);

			const rows = stats.stores.map(store => {
				const hints = staticHints.get(store.storeName) ?? {};
				return {
					id: hints.id ?? store.storeId,
					name: store.storeName,
					kind: hints.kind,
					file: hints.file,
					mounts: store.mounts,
					changes: store.changes,
					errors: store.actionsErrored,
					lastChangeMsAgo: getLastChangeMsAgo(store, now),
				};
			});

			const toon = toToon({ stores: rows });

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/toon",
						text: toon,
					},
				],
			};
		},
	);
}

/**
 * Aggregated runtime events in TOON:
 *   nanostores://runtime/events-agg-toon
 */
export function registerRuntimeEventsAggToonResource(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerResource(
		"runtime-events-agg-toon",
		URIS.runtimeEventsAggToon,
		{
			title: "Nanostores runtime events aggregates (TOON)",
			description:
				"Aggregated runtime activity per store, encoded as TOON for compact representation.",
		},
		async uri => {
			const stats = runtimeService.getStats();
			const now = Date.now();
			const staticHints = await buildStaticHints(runtimeService, stats.stores);

			const rows = await Promise.all(
				stats.stores.map(async store => {
					const hints = staticHints.get(store.storeName) ?? {};
					const changeEvents = runtimeService.getEvents({
						storeName: store.storeName,
						kinds: ["change"],
					});

					return {
						id: hints.id ?? store.storeId ?? store.storeName,
						events: getStoreEventCount(store),
						changes: store.changes,
						errors: store.actionsErrored,
						maxChangesPerSecond: computeMaxChangesPerSecond(changeEvents),
						lastEventMsAgo: Math.max(0, now - store.lastSeen),
						exampleEventType: pickExampleEventType(store),
					};
				}),
			);

			const toon = toToon({ storeAgg: rows });

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/toon",
						text: toon,
					},
				],
			};
		},
	);
}
