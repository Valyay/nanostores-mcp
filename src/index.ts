import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildNanostoresServer } from "./server.js";
import { setClientRoots } from "./config/settings.js";

// Re-export server builder for programmatic usage
export { buildNanostoresServer } from "./server.js";
export type { NanostoresServer } from "./server.js";

/**
 * Fetch workspace roots from the MCP client and apply them to settings.
 * Best-effort: errors are silently ignored since client roots are optional.
 */
async function fetchAndApplyClientRoots(
	mcpServer: McpServer,
	onRootsChanged?: () => void,
): Promise<void> {
	try {
		const result = await mcpServer.server.listRoots();
		setClientRoots(result.roots);
		onRootsChanged?.();
	} catch {
		// Client roots are best-effort — env vars or cwd will be used instead
	}
}

/**
 * Main entry point: builds the MCP server and connects it to stdio transport.
 * Can be called from CLI or imported programmatically.
 */
export async function main(): Promise<void> {
	const app = buildNanostoresServer();

	// Start logger bridge if enabled (best-effort, non-blocking)
	app.loggerBridge.start().catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[nanostores-mcp] Logger bridge failed to start: ${message}\n`);
	});

	// Graceful shutdown on signals
	const onShutdown = (): void => {
		void app.shutdown().then(() => process.exit(0));
	};
	process.on("SIGINT", onShutdown);
	process.on("SIGTERM", onShutdown);

	// Client roots integration
	app.server.server.oninitialized = (): void => {
		const capabilities = app.server.server.getClientCapabilities();
		if (!capabilities?.roots) return;

		void fetchAndApplyClientRoots(app.server, app.reinitializeDocs);

		if (capabilities.roots.listChanged) {
			app.server.server.setNotificationHandler(
				RootsListChangedNotificationSchema,
				async () => {
					await fetchAndApplyClientRoots(app.server, app.reinitializeDocs);
				},
			);
		}
	};

	const transport = new StdioServerTransport();
	await app.server.connect(transport);
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
