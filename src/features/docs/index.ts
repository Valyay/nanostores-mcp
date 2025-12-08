import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsService } from "../../domain/index.js";
import {
	registerDocsIndexResource,
	registerDocsPageResource,
	registerDocsSearchResource,
} from "../../mcp/resources/docs.js";
import { registerDocsSearchTool, registerDocsForStoreTool } from "../../mcp/tools/docs.js";
import { registerDocsHowToPrompt } from "../../mcp/prompts/docsHowTo.js";

/**
 * Registers all documentation features (docs index, search, tools, prompts).
 * If docsService is null, no features are registered.
 */
export function registerDocsFeatures(server: McpServer, docsService: DocsService | null): void {
	if (!docsService) {
		return;
	}

	// Resources
	registerDocsIndexResource(server, docsService);
	registerDocsPageResource(server, docsService);
	registerDocsSearchResource(server, docsService);

	// Tools
	registerDocsSearchTool(server, docsService);
	registerDocsForStoreTool(server, docsService);

	// Prompts
	registerDocsHowToPrompt(server);
}
