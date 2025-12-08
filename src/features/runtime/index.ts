import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerEventStore } from "../../domain/loggerEventStore.js";
import type { LoggerBridgeServer } from "../../logger/loggerBridge.js";
import { registerPingTool } from "../../mcp/tools/ping.js";
import {
	registerStoreActivityTool,
	registerFindNoisyStoresTool,
	registerRuntimeOverviewTool,
} from "../../mcp/tools/runtime.js";
import {
	registerRuntimeEventsResource,
	registerRuntimeStatsResource,
	registerRuntimeStoreResource,
} from "../../mcp/resources/runtime.js";
import {
	registerDebugStorePrompt,
	registerDebugProjectActivityPrompt,
} from "../../mcp/prompts/debugRuntime.js";

/**
 * Registers all runtime features (logger bridge, event store, runtime monitoring).
 */
export function registerRuntimeFeatures(
	server: McpServer,
	eventStore: LoggerEventStore,
	bridge: LoggerBridgeServer,
): void {
	// Tools
	registerPingTool(server, bridge);
	registerStoreActivityTool(server, eventStore);
	registerFindNoisyStoresTool(server, eventStore);
	registerRuntimeOverviewTool(server, eventStore);

	// Resources
	registerRuntimeEventsResource(server, eventStore);
	registerRuntimeStatsResource(server, eventStore);
	registerRuntimeStoreResource(server, eventStore);

	// Prompts
	registerDebugStorePrompt(server);
	registerDebugProjectActivityPrompt(server);
}
