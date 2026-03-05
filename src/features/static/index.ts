import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectAnalysisService } from "../../domain/index.js";
import type { SuggestStoreNamesFn } from "../../mcp/shared/storeAutocomplete.js";
import { registerScanProjectTool } from "../../mcp/tools/scanProject.js";
import { registerStoreSummaryTool } from "../../mcp/tools/storeSummary.js";
import { registerClearCacheTool } from "../../mcp/tools/clearCache.js";
import { registerStoreResource } from "../../mcp/resources/store.js";
import { registerGraphResource } from "../../mcp/resources/graph.js";
import {
	registerGraphOutlineResource,
	registerStoreSubgraphResource,
} from "../../mcp/resources/graphExtras.js";
import { registerExplainProjectPrompt } from "../../mcp/prompts/explainProject.js";
import { registerExplainStorePrompt } from "../../mcp/prompts/explainStore.js";

/**
 * Registers all static AST-based features (project scanning, store analysis, graph generation).
 */
export function registerStaticFeatures(
	server: McpServer,
	projectService: ProjectAnalysisService,
	suggestStoreNames: SuggestStoreNamesFn,
	resetAutocompleteCache: () => void,
): void {
	// Tools
	registerScanProjectTool(server, projectService);
	registerStoreSummaryTool(server, projectService);
	registerClearCacheTool(server, projectService, resetAutocompleteCache);

	// Resources
	registerStoreResource(server, projectService);
	registerGraphResource(server, projectService);
	registerGraphOutlineResource(server, projectService);
	registerStoreSubgraphResource(server, projectService);

	// Prompts
	registerExplainProjectPrompt(server);
	registerExplainStorePrompt(server, suggestStoreNames);
}
