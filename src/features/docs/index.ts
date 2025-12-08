import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsRepository } from "../../domain/docsIndex.js";
import {
	registerDocsIndexResource,
	registerDocsPageResource,
	registerDocsSearchResource,
} from "../../mcp/resources/docs.js";
import { registerDocsSearchTool, registerDocsForStoreTool } from "../../mcp/tools/docs.js";
import { registerDocsHowToPrompt } from "../../mcp/prompts/docsHowTo.js";

/**
 * Registers all documentation features (docs index, search, tools, prompts).
 * If docsRepo is null, no features are registered.
 */
export function registerDocsFeatures(
	server: McpServer,
	docsRepo: DocsRepository | null,
): void {
	if (!docsRepo) {
		return;
	}

	// Resources
	registerDocsIndexResource(server, docsRepo);
	registerDocsPageResource(server, docsRepo);
	registerDocsSearchResource(server, docsRepo);

	// Tools
	registerDocsSearchTool(server, docsRepo);
	registerDocsForStoreTool(server, docsRepo);

	// Prompts
	registerDocsHowToPrompt(server);
}
