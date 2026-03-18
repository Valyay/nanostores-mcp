import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsService } from "../../domain/index.js";
import { registerDocsIndexResource, registerDocsPageResource } from "../../mcp/resources/docs.js";
import { registerDocsSearchTool } from "../../mcp/tools/docs.js";
import { registerDocsHowToPrompt } from "../../mcp/prompts/docsHowTo.js";

/**
 * Registers all documentation features (docs index, search, tools, prompts).
 * Accepts a getter so docs can be lazily initialized after client roots arrive.
 * Features are always registered; when docsService is null, each handler
 * returns a "docs disabled" message instead.
 */
export function registerDocsFeatures(
	server: McpServer,
	getDocsService: () => DocsService | null,
): void {
	// Resources
	registerDocsIndexResource(server, getDocsService);
	registerDocsPageResource(server, getDocsService);

	// Tool (single entry point for all docs lookup)
	registerDocsSearchTool(server, getDocsService);

	// Prompts
	registerDocsHowToPrompt(server);
}
