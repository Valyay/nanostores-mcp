import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeAnalysisService } from "../../domain/index.js";

const StoreActivityInputSchema = z.object({
	storeName: z.string().optional().describe("Store name to query (optional)"),
	limit: z.number().optional().default(50).describe("Max events to return"),
	windowMs: z.number().optional().describe("Time window in milliseconds (from now back)"),
});

const StoreActivityOutputSchema = z.object({
	storeName: z.string().optional(),
	stats: z.any(),
	events: z.array(z.any()),
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
				"Retrieve runtime activity data for a specific nanostores store: recent events, change frequency, action calls, errors.",
			inputSchema: StoreActivityInputSchema,
			outputSchema: StoreActivityOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: false, // data changes over time
				openWorldHint: false,
			},
		},
		async ({ storeName, limit, windowMs }) => {
			const sinceTs = windowMs ? Date.now() - windowMs : undefined;

			const events = runtimeService.getEvents({
				storeName,
				limit,
				sinceTs,
			});

			let stats = null;
			if (storeName) {
				const profile = await runtimeService.getStoreProfile(storeName);
				stats = profile?.stats ?? null;
			} else {
				stats = runtimeService.getStats();
			}

			// Build summary
			let summary = "";
			if (storeName) {
				if (!stats) {
					summary = `No runtime data found for store "${storeName}". The store may not be instrumented or no events have been received yet.`;
				} else if ("mounts" in stats) {
					// StoreRuntimeStats
					summary = `Store "${storeName}":\n`;
					summary += `- Mounted: ${stats.mounts} times\n`;
					summary += `- Changes: ${stats.changes}\n`;
					summary += `- Actions started: ${stats.actionsStarted}\n`;
					summary += `- Actions completed: ${stats.actionsCompleted}\n`;
					summary += `- Actions errored: ${stats.actionsErrored}\n`;
					summary += `- Recent events: ${events.length}`;
					if (stats.lastChange) {
						summary += `\n- Last change: ${new Date(stats.lastChange.timestamp).toISOString()}`;
					}
				}
			} else if (stats && "stores" in stats) {
				// LoggerStatsSnapshot
				summary = `Overall activity:\n`;
				summary += `- Total stores: ${stats.stores.length}\n`;
				summary += `- Total events: ${stats.totalEvents}\n`;
				summary += `- Session started: ${new Date(stats.sessionStartedAt).toISOString()}\n`;
				summary += `- Last event: ${new Date(stats.lastEventAt).toISOString()}`;
			}

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
		},
	);
}

const FindNoisyStoresInputSchema = z.object({
	limit: z.number().optional().default(5).describe("Number of stores to return"),
	windowMs: z.number().optional().describe("Time window in milliseconds (from now back)"),
});

const FindNoisyStoresOutputSchema = z.object({
	stores: z.array(z.any()),
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
				"Identify nanostores stores with the highest activity: frequent changes, many action calls. Useful for finding performance bottlenecks.",
			inputSchema: FindNoisyStoresInputSchema,
			outputSchema: FindNoisyStoresOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ limit, windowMs }) => {
			const noisyStores = runtimeService.getNoisyStores(limit);

			// Filter by time window if specified
			let filteredStores = noisyStores;
			if (windowMs) {
				const sinceTs = Date.now() - windowMs;
				filteredStores = noisyStores.filter(s => s.lastSeen >= sinceTs);
			}

			let summary = "";
			if (filteredStores.length === 0) {
				summary = "No active stores found.";
			} else {
				summary = `Top ${filteredStores.length} most active stores:\n\n`;
				for (const store of filteredStores) {
					const activity = store.changes + store.actionsStarted;
					summary += `• ${store.storeName}: ${activity} total activity (${store.changes} changes, ${store.actionsStarted} actions)\n`;
					if (store.actionsErrored > 0) {
						summary += `  ⚠️  ${store.actionsErrored} errors\n`;
					}
				}
			}

			const output = {
				stores: filteredStores,
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
		},
	);
}

const RuntimeOverviewInputSchema = z.object({
	windowMs: z.number().optional().describe("Time window in milliseconds (from now back)"),
});

const RuntimeOverviewOutputSchema = z.object({
	summary: z.string(),
	stats: z.any(),
	noisyStores: z.array(z.any()),
	errorProneStores: z.array(z.any()),
	unmountedStores: z.array(z.any()),
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
				"Get overall health report of nanostores runtime: active stores, error-prone stores, unused stores, activity patterns.",
			inputSchema: RuntimeOverviewInputSchema,
			outputSchema: RuntimeOverviewOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ windowMs }) => {
			const stats = runtimeService.getStats();
			const noisyStores = runtimeService.getNoisyStores(5);
			const errorProneStores = runtimeService.getErrorProneStores(1);
			const unmountedStores = runtimeService.getUnmountedStores();

			// Filter by time window if specified
			let activeStores = stats.stores;
			if (windowMs) {
				const sinceTs = Date.now() - windowMs;
				activeStores = stats.stores.filter(s => s.lastSeen >= sinceTs);
			}

			let summary = "=== Nanostores Runtime Overview ===\n\n";
			summary += `Session started: ${new Date(stats.sessionStartedAt).toISOString()}\n`;
			summary += `Last event: ${new Date(stats.lastEventAt).toISOString()}\n`;
			summary += `Total events: ${stats.totalEvents}\n`;
			summary += `Total stores seen: ${stats.stores.length}\n`;
			if (windowMs) {
				summary += `Active in last ${windowMs}ms: ${activeStores.length}\n`;
			}
			summary += "\n";

			if (noisyStores.length > 0) {
				summary += `🔥 Top 5 most active stores:\n`;
				for (const store of noisyStores) {
					summary += `  • ${store.storeName}: ${store.changes} changes, ${store.actionsStarted} actions\n`;
				}
				summary += "\n";
			}

			if (errorProneStores.length > 0) {
				summary += `⚠️  Stores with errors:\n`;
				for (const store of errorProneStores) {
					summary += `  • ${store.storeName}: ${store.actionsErrored} errors out of ${store.actionsStarted} actions\n`;
					if (store.lastError) {
						summary += `    Last error: ${new Date(store.lastError.timestamp).toISOString()}\n`;
					}
				}
				summary += "\n";
			}

			if (unmountedStores.length > 0) {
				summary += `💤 Stores never mounted (${unmountedStores.length}):\n`;
				for (const store of unmountedStores.slice(0, 10)) {
					summary += `  • ${store.storeName}\n`;
				}
				if (unmountedStores.length > 10) {
					summary += `  ... and ${unmountedStores.length - 10} more\n`;
				}
				summary += "\n";
			}

			if (
				stats.stores.length === 0 ||
				(noisyStores.length === 0 && errorProneStores.length === 0)
			) {
				summary +=
					"📭 No runtime activity detected. Make sure:\n" +
					"  1. Your app is running with @nanostores/logger integration\n" +
					"  2. Logger bridge is enabled (NANOSTORES_MCP_LOGGER_ENABLED=true)\n" +
					"  3. Events are being sent to the correct port\n";
			}

			const output = {
				summary,
				stats,
				noisyStores,
				errorProneStores,
				unmountedStores,
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
		},
	);
}
