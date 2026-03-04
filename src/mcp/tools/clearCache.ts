import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProjectAnalysisService } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

const ClearCacheInputSchema = z.object({
	rootUri: z
		.string()
		.optional()
		.describe("Workspace root to clear cache for. Omit to clear all roots."),
});

export function registerClearCacheTool(
	server: McpServer,
	projectService: ProjectAnalysisService,
	resetAutocompleteCache: () => void,
): void {
	server.registerTool(
		"clear_cache",
		{
			title: "Clear project analysis cache",
			description:
				"Clears the cached project index so that the next scan_project " +
				"call performs a fresh scan. Use after file changes that the " +
				"server may not have detected.",
			inputSchema: ClearCacheInputSchema,
			annotations: {
				readOnlyHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ rootUri }) => {
			if (rootUri) {
				const rootPath = resolveWorkspaceRoot(rootUri);
				projectService.clearCache(rootPath);
			} else {
				projectService.clearCache();
			}
			resetAutocompleteCache();

			const scope = rootUri ? `root: ${rootUri}` : "all roots";
			return {
				content: [{ type: "text" as const, text: `Cache cleared for ${scope}.` }],
			};
		},
	);
}
