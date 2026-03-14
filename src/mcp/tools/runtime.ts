import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encode as toToon } from "@toon-format/toon";
import type { RuntimeAnalysisService } from "../../domain/index.js";
import type { StoreRuntimeStats, LoggerStatsSnapshot } from "../../domain/runtime/types.js";
import {
	buildStaticHints,
	computeMaxChangesPerSecond,
	getLastChangeMsAgo,
	getStoreEventCount,
	pickExampleEventType,
} from "../shared/runtimeHelpers.js";

// ── Reusable Zod schemas matching domain/runtime/types.ts ────────────────────

const BaseEventFields = {
	storeName: z.string(),
	storeId: z.string().optional(),
	timestamp: z.number(),
	sessionId: z.string().optional(),
	projectRoot: z.string().optional(),
};

const ChangeEventSchema = z.object({
	...BaseEventFields,
	kind: z.literal("change"),
	actionId: z.string().optional(),
	actionName: z.string().optional(),
	changed: z.union([z.string(), z.array(z.string())]).optional(),
	newValue: z.unknown().optional(),
	oldValue: z.unknown().optional(),
	valueMessage: z.string().optional(),
});

const ActionErrorEventSchema = z.object({
	...BaseEventFields,
	kind: z.literal("action-error"),
	actionId: z.string(),
	actionName: z.string().optional(),
	error: z.unknown().optional(),
	errorMessage: z.string().optional(),
});

const LoggerEventSchema = z.discriminatedUnion("kind", [
	z.object({ ...BaseEventFields, kind: z.literal("mount") }),
	z.object({ ...BaseEventFields, kind: z.literal("unmount") }),
	ChangeEventSchema,
	z.object({
		...BaseEventFields,
		kind: z.literal("action-start"),
		actionId: z.string(),
		actionName: z.string(),
		args: z.array(z.unknown()).optional(),
	}),
	z.object({
		...BaseEventFields,
		kind: z.literal("action-end"),
		actionId: z.string(),
		actionName: z.string().optional(),
	}),
	ActionErrorEventSchema,
]);

const StoreRuntimeStatsSchema = z.object({
	storeName: z.string(),
	storeId: z.string().optional(),
	projectRoot: z.string().optional(),
	firstSeen: z.number(),
	lastSeen: z.number(),
	mounts: z.number(),
	unmounts: z.number(),
	changes: z.number(),
	actionsStarted: z.number(),
	actionsErrored: z.number(),
	actionsCompleted: z.number(),
	lastChange: ChangeEventSchema.optional(),
	lastError: ActionErrorEventSchema.optional(),
});

const LoggerStatsSnapshotSchema = z.object({
	stores: z.array(StoreRuntimeStatsSchema),
	totalEvents: z.number(),
	sessionStartedAt: z.number(),
	lastEventAt: z.number(),
});

// ── Summary builders (exported for testing) ─────────────────────────────────

export function buildStoreActivitySummary(
	storeName: string | undefined,
	stats: StoreRuntimeStats | LoggerStatsSnapshot | null,
	hasStaticData: boolean,
	eventsCount: number,
): string {
	if (storeName) {
		if (!stats) {
			return `No runtime data found for store "${storeName}". The store may not be instrumented or no events have been received yet.`;
		} else if ("mounts" in stats && !("stores" in stats)) {
			let summary = `Store "${storeName}"`;
			if (hasStaticData) {
				summary += " (combined with static analysis data)";
			}
			summary += ":\n";
			summary += `- Mounted: ${stats.mounts} times\n`;
			summary += `- Changes: ${stats.changes}\n`;
			summary += `- Actions started: ${stats.actionsStarted}\n`;
			summary += `- Actions completed: ${stats.actionsCompleted}\n`;
			summary += `- Actions errored: ${stats.actionsErrored}\n`;
			summary += `- Recent events: ${eventsCount}`;
			if (stats.lastChange) {
				summary += `\n- Last change: ${new Date(stats.lastChange.timestamp).toISOString()}`;
			}
			return summary;
		}
	} else if (stats && "stores" in stats) {
		let summary = `Overall activity:\n`;
		summary += `- Total stores: ${stats.stores.length}\n`;
		summary += `- Total events: ${stats.totalEvents}\n`;
		summary += `- Session started: ${new Date(stats.sessionStartedAt).toISOString()}\n`;
		summary += `- Last event: ${new Date(stats.lastEventAt).toISOString()}`;
		return summary;
	}
	return "";
}

export function buildNoisyStoresSummary(
	stores: Pick<StoreRuntimeStats, "storeName" | "changes" | "actionsStarted" | "actionsErrored">[],
): string {
	if (stores.length === 0) {
		return "No active stores found.";
	}
	let summary = `Top ${stores.length} most active stores:\n\n`;
	for (const store of stores) {
		const activity = store.changes + store.actionsStarted;
		summary += `\u2022 ${store.storeName}: ${activity} total activity (${store.changes} changes, ${store.actionsStarted} actions)\n`;
		if (store.actionsErrored > 0) {
			summary += `  \u26A0\uFE0F  ${store.actionsErrored} errors\n`;
		}
	}
	return summary;
}

export function buildRuntimeOverviewSummary(args: {
	stats: LoggerStatsSnapshot;
	noisyStores: StoreRuntimeStats[];
	errorProneStores: StoreRuntimeStats[];
	unmountedStores: StoreRuntimeStats[];
	windowMs?: number;
	activeStoresCount?: number;
}): string {
	const { stats, noisyStores, errorProneStores, unmountedStores, windowMs, activeStoresCount } =
		args;

	let summary = "=== Nanostores Runtime Overview ===\n\n";
	summary += `Session started: ${new Date(stats.sessionStartedAt).toISOString()}\n`;
	summary += `Last event: ${new Date(stats.lastEventAt).toISOString()}\n`;
	summary += `Total events: ${stats.totalEvents}\n`;
	summary += `Total stores seen: ${stats.stores.length}\n`;
	if (windowMs && activeStoresCount !== undefined) {
		summary += `Active in last ${windowMs}ms: ${activeStoresCount}\n`;
	}
	summary += "\n";

	if (noisyStores.length > 0) {
		summary += `\uD83D\uDD25 Top 5 most active stores:\n`;
		for (const store of noisyStores) {
			summary += `  \u2022 ${store.storeName}: ${store.changes} changes, ${store.actionsStarted} actions\n`;
		}
		summary += "\n";
	}

	if (errorProneStores.length > 0) {
		summary += `\u26A0\uFE0F  Stores with errors:\n`;
		for (const store of errorProneStores) {
			summary += `  \u2022 ${store.storeName}: ${store.actionsErrored} errors out of ${store.actionsStarted} actions\n`;
			if (store.lastError) {
				summary += `    Last error: ${new Date(store.lastError.timestamp).toISOString()}\n`;
			}
		}
		summary += "\n";
	}

	if (unmountedStores.length > 0) {
		summary += `\uD83D\uDCAC Stores never mounted (${unmountedStores.length}):\n`;
		for (const store of unmountedStores.slice(0, 10)) {
			summary += `  \u2022 ${store.storeName}\n`;
		}
		if (unmountedStores.length > 10) {
			summary += `  ... and ${unmountedStores.length - 10} more\n`;
		}
		summary += "\n";
	}

	if (stats.stores.length === 0 || (noisyStores.length === 0 && errorProneStores.length === 0)) {
		summary +=
			"\uD83D\uDCED No runtime activity detected. Make sure:\n" +
			"  1. Your app is running with @nanostores/logger integration\n" +
			"  2. Logger bridge is enabled (NANOSTORES_MCP_LOGGER_ENABLED=true)\n" +
			"  3. Events are being sent to the correct port\n";
	}

	return summary;
}

// ── Input / Output schemas ───────────────────────────────────────────────────

const StoreActivityInputSchema = z.object({
	storeName: z.string().optional().describe("Store name to query (optional)"),
	limit: z.number().optional().default(50).describe("Max events to return"),
	windowMs: z.number().optional().describe("Time window in milliseconds (from now back)"),
	projectRoot: z
		.string()
		.optional()
		.describe("Project root path to link runtime data with static analysis"),
	kinds: z
		.array(z.enum(["mount", "unmount", "change", "action-start", "action-end", "action-error"]))
		.min(1)
		.optional()
		.describe("Filter events by kind(s)"),
	actionName: z.string().optional().describe("Filter events by action name"),
});

const StoreActivityOutputSchema = z.object({
	storeName: z.string().optional(),
	stats: z.union([StoreRuntimeStatsSchema, LoggerStatsSnapshotSchema]).nullable(),
	events: z.array(LoggerEventSchema),
	summary: z.string(),
});

/**
 * Tool: nanostores_store_activity
 * Get runtime activity for a specific store or all stores
 */
export function registerStoreActivityTool(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerTool(
		"nanostores_store_activity",
		{
			title: "Get store runtime activity",
			description:
				"Use this when debugging a specific store's runtime behavior — why it updates too often, " +
				"what actions trigger changes, or whether it emits errors. " +
				"Returns recent events, change frequency, action calls, and errors. " +
				"Supports filtering by event kind (kinds) and action name (actionName).",
			inputSchema: StoreActivityInputSchema,
			outputSchema: StoreActivityOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ storeName, limit, windowMs, projectRoot, kinds, actionName }) => {
			try {
				const sinceTs = windowMs ? Date.now() - windowMs : undefined;

				const events = runtimeService.getEvents({
					storeName,
					limit,
					sinceTs,
					kinds,
					actionName,
				});

				let stats = null;
				let hasStaticData = false;
				if (storeName) {
					const profile = await runtimeService.getStoreProfile(storeName, projectRoot);
					stats = profile?.stats ?? null;
					hasStaticData = !!(profile?.id || profile?.kind || profile?.file);
				} else {
					stats = runtimeService.getStats();
				}

				const summary = buildStoreActivitySummary(storeName, stats, hasStaticData, events.length);

				const output = {
					storeName,
					stats,
					events,
					summary,
				};

				return {
					content: [
						{
							type: "text",
							text: summary,
						},
					],
					structuredContent: output,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								`Failed to get store activity.` +
								(storeName
									? ` Verify the store name "${storeName}" is correct (use nanostores_list_stores to check available stores).`
									: ``) +
								` Ensure the app is running with @nanostores/logger and events are being sent to the logger bridge.` +
								`\n\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}

const FindNoisyStoresInputSchema = z.object({
	limit: z.number().optional().default(5).describe("Number of stores to return"),
	windowMs: z.number().optional().describe("Time window in milliseconds (from now back)"),
	compact: z
		.boolean()
		.optional()
		.describe("Return TOON-encoded compact table for lower token cost"),
});

const FindNoisyStoresOutputSchema = z.object({
	stores: z.array(StoreRuntimeStatsSchema),
	summary: z.string(),
});
/**
 * Tool: nanostores_find_noisy_stores
 * Find stores with highest activity (changes + actions)
 */
export function registerFindNoisyStoresTool(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerTool(
		"nanostores_find_noisy_stores",
		{
			title: "Find noisy stores",
			description:
				"Use this when investigating performance issues or excessive re-renders. " +
				"Returns stores ranked by activity — frequent changes, many action calls — " +
				"to pinpoint bottlenecks.",
			inputSchema: FindNoisyStoresInputSchema,
			outputSchema: FindNoisyStoresOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ limit, windowMs, compact }) => {
			try {
				const noisyStores = runtimeService.getNoisyStores(limit);

				// Filter by time window if specified
				let filteredStores = noisyStores;
				if (windowMs) {
					const sinceTs = Date.now() - windowMs;
					filteredStores = noisyStores.filter(s => s.lastSeen >= sinceTs);
				}

				const summary = buildNoisyStoresSummary(filteredStores);

				const output = {
					stores: filteredStores,
					summary,
				};

				if (compact) {
					const now = Date.now();
					const rows = await Promise.all(
						filteredStores.map(async store => {
							const changeEvents = runtimeService.getEvents({
								storeName: store.storeName,
								kinds: ["change"],
							});

							return {
								id: store.storeId ?? store.storeName,
								events: getStoreEventCount(store),
								changes: store.changes,
								errors: store.actionsErrored,
								maxChangesPerSecond: computeMaxChangesPerSecond(changeEvents),
								lastEventMsAgo: Math.max(0, now - store.lastSeen),
								exampleEventType: pickExampleEventType(store),
							};
						}),
					);

					return {
						content: [{ type: "text" as const, text: toToon({ storeAgg: rows }) }],
						structuredContent: output,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: summary,
						},
					],
					structuredContent: output,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								`Failed to find noisy stores.` +
								` Ensure the app is running with @nanostores/logger and events are being sent to the logger bridge.` +
								` If no stores appear active, try nanostores_runtime_overview for a health check.` +
								`\n\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}

const RuntimeOverviewInputSchema = z.object({
	windowMs: z.number().optional().describe("Time window in milliseconds (from now back)"),
	compact: z
		.boolean()
		.optional()
		.describe("Return TOON-encoded compact table for lower token cost"),
});

const RuntimeOverviewOutputSchema = z.object({
	summary: z.string(),
	stats: LoggerStatsSnapshotSchema,
	noisyStores: z.array(StoreRuntimeStatsSchema),
	errorProneStores: z.array(StoreRuntimeStatsSchema),
	unmountedStores: z.array(StoreRuntimeStatsSchema),
});

/**
 * Tool: nanostores_runtime_overview
 * Get overall runtime health report
 */
export function registerRuntimeOverviewTool(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
): void {
	server.registerTool(
		"nanostores_runtime_overview",
		{
			title: "Get runtime overview",
			description:
				"Use this when you want a high-level health check of the running app's state management. " +
				"Returns active stores, error-prone stores, unused stores, and activity patterns.",
			inputSchema: RuntimeOverviewInputSchema,
			outputSchema: RuntimeOverviewOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ windowMs, compact }) => {
			try {
				const stats = runtimeService.getStats();
				const noisyStores = runtimeService.getNoisyStores(5);
				const errorProneStores = runtimeService.getErrorProneStores(1);
				const unmountedStores = runtimeService.getUnmountedStores();

				// Filter by time window if specified
				let activeStoresCount: number | undefined;
				if (windowMs) {
					const sinceTs = Date.now() - windowMs;
					activeStoresCount = stats.stores.filter(s => s.lastSeen >= sinceTs).length;
				}

				const summary = buildRuntimeOverviewSummary({
					stats,
					noisyStores,
					errorProneStores,
					unmountedStores,
					windowMs,
					activeStoresCount,
				});

				const output = {
					summary,
					stats,
					noisyStores,
					errorProneStores,
					unmountedStores,
				};

				if (compact) {
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

					return {
						content: [{ type: "text" as const, text: toToon({ stores: rows }) }],
						structuredContent: output,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: summary,
						},
					],
					structuredContent: output,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								`Failed to get runtime overview.` +
								` Check that the logger bridge is receiving events on port NANOSTORES_MCP_LOGGER_PORT (default 3999).` +
								` Ensure the app is running with @nanostores/logger integration.` +
								`\n\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}
