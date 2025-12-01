import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildNanostoresServer } from "./server.js";

// Re-export server builder for programmatic usage
export { buildNanostoresServer } from "./server.js";

/**
 * Main entry point: builds the MCP server and connects it to stdio transport.
 * Can be called from CLI or imported programmatically.
 */
export async function main(): Promise<void> {
	const server = buildNanostoresServer();

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

// Auto-start when run directly (not imported)
// Check if this module is the entry point
const isMainModule =
	typeof process !== "undefined" &&
	process.argv[1] &&
	(process.argv[1].endsWith("/index.js") ||
		process.argv[1].endsWith("/index.ts") ||
		process.argv[1].includes("nanostores-mcp/dist/index") ||
		process.argv[1].includes("nanostores-mcp/src/index"));

if (isMainModule) {
	main().catch(error => {
		// eslint-disable-next-line no-console
		console.error("[nanostores-mcp] Fatal error:", error);
		process.exit(1);
	});
}
