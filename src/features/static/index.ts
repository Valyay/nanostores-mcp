import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectAnalysisService } from "../../domain/projectAnalysisService.js";
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
export function registerStaticFeatures(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	// Tools
	registerScanProjectTool(server, projectService);
	registerStoreSummaryTool(server, projectService);

	// Resources
	registerStoreResource(server, projectService);
	registerGraphResource(server, projectService);
	registerGraphMermaidResource(server, projectService);

	// Prompts
	registerExplainProjectPrompt(server);
	registerExplainStorePrompt(server);
}
