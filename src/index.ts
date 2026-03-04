import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildNanostoresServer } from "./server.js";
import { setClientRoots } from "./config/settings.js";

// Re-export server builder for programmatic usage
export { buildNanostoresServer } from "./server.js";

/**
 * Fetch workspace roots from the MCP client and apply them to settings.
 * Best-effort: errors are silently ignored since client roots are optional.
 */
async function fetchAndApplyClientRoots(mcpServer: McpServer): Promise<void> {
	try {
		const result = await mcpServer.server.listRoots();
		setClientRoots(result.roots);
	} catch {
		// Client roots are best-effort — env vars or cwd will be used instead
	}
}

/**
 * Main entry point: builds the MCP server and connects it to stdio transport.
 * Can be called from CLI or imported programmatically.
 */
export async function main(): Promise<void> {
	const mcpServer = buildNanostoresServer();

	mcpServer.server.oninitialized = (): void => {
		const capabilities = mcpServer.server.getClientCapabilities();
		if (!capabilities?.roots) return;

		void fetchAndApplyClientRoots(mcpServer);

		if (capabilities.roots.listChanged) {
			mcpServer.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
				await fetchAndApplyClientRoots(mcpServer);
			});
		}
	};

	const transport = new StdioServerTransport();
	await mcpServer.connect(transport);
}

// Auto-start when run directly (not imported)
// Check if this module is the entry point
const isMainModule =
	typeof process !== "undefined" &&
	typeof import.meta !== "undefined" &&
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
	main().catch((error: unknown) => {
		const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`[nanostores-mcp] Fatal error: ${detail}\n`);
		process.exit(1);
	});
}
