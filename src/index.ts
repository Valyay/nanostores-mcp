import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildNanostoresServer } from "./server.js";

async function main(): Promise<void> {
	const server = buildNanostoresServer();

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

// eslint / ts не любят "висящие" промисы, поэтому явно ловим ошибку
main().catch(error => {
	// Логи MCP-серверов обычно уходят в stderr, чтобы не мешать протоколу
	// eslint-disable-next-line no-console
	console.error("[nanostores-mcp] Fatal error:", error);
	process.exit(1);
});
