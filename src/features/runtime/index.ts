import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeAnalysisService } from "../../domain/index.js";
import type { SuggestStoreNamesFn } from "../../mcp/shared/storeAutocomplete.js";
import {
	registerStoreActivityTool,
	registerFindNoisyStoresTool,
	registerRuntimeOverviewTool,
} from "../../mcp/tools/runtime.js";
import {
	registerRuntimeEventsResource,
	registerRuntimeStatsResource,
	registerRuntimeStoreResource,
	registerRuntimeOverviewResource,
	registerRuntimeStatsToonResource,
	registerRuntimeEventsAggToonResource,
} from "../../mcp/resources/runtime.js";
import {
	registerDebugStorePrompt,
	registerDebugProjectActivityPrompt,
} from "../../mcp/prompts/debugRuntime.js";

/**
 * Registers runtime features (event store, runtime monitoring).
 * Only call when NANOSTORES_MCP_LOGGER_ENABLED=true; ping is registered separately.
 */
export function registerRuntimeFeatures(
	server: McpServer,
	runtimeService: RuntimeAnalysisService,
	suggestStoreNames: SuggestStoreNamesFn,
): void {
	// Tools
	registerStoreActivityTool(server, runtimeService);
	registerFindNoisyStoresTool(server, runtimeService);
	registerRuntimeOverviewTool(server, runtimeService);

	// Resources
	registerRuntimeEventsResource(server, runtimeService);
	registerRuntimeStatsResource(server, runtimeService);
	registerRuntimeOverviewResource(server, runtimeService);
	registerRuntimeStatsToonResource(server, runtimeService);
	registerRuntimeEventsAggToonResource(server, runtimeService);
	registerRuntimeStoreResource(server, runtimeService);

	// Prompts
	registerDebugStorePrompt(server, suggestStoreNames);
	registerDebugProjectActivityPrompt(server);
}
