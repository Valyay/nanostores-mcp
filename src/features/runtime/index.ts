import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeAnalysisService } from "../../domain/index.js";
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
	runtimeService: RuntimeAnalysisService,
	bridge: LoggerBridgeServer,
): void {
	// Tools
	registerPingTool(server, bridge);
	registerStoreActivityTool(server, runtimeService);
	registerFindNoisyStoresTool(server, runtimeService);
	registerRuntimeOverviewTool(server, runtimeService);

	// Resources
	registerRuntimeEventsResource(server, runtimeService);
	registerRuntimeStatsResource(server, runtimeService);
	registerRuntimeStoreResource(server, runtimeService);

	// Prompts
	registerDebugStorePrompt(server);
	registerDebugProjectActivityPrompt(server);
}
