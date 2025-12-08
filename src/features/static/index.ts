import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScanProjectTool } from "../../mcp/tools/scanProject.js";
import { registerStoreSummaryTool } from "../../mcp/tools/storeSummary.js";
import { registerStoreResource } from "../../mcp/resources/store.js";
import { registerGraphResource } from "../../mcp/resources/graph.js";
import { registerGraphMermaidResource } from "../../mcp/resources/graphMermaid.js";
import { registerExplainProjectPrompt } from "../../mcp/prompts/explainProject.js";
import { registerExplainStorePrompt } from "../../mcp/prompts/explainStore.js";

/**
 * Registers all static AST-based features (project scanning, store analysis, graph generation).
 */
export function registerStaticFeatures(server: McpServer): void {
	// Tools
	registerScanProjectTool(server);
	registerStoreSummaryTool(server);

	// Resources
	registerStoreResource(server);
	registerGraphResource(server);
	registerGraphMermaidResource(server);

	// Prompts
	registerExplainProjectPrompt(server);
	registerExplainStorePrompt(server);
}
