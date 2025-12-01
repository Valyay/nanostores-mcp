#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildNanostoresServer } from "./server.js";

async function main(): Promise<void> {
	const server = buildNanostoresServer();

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(error => {
	// eslint-disable-next-line no-console
	console.error("[nanostores-mcp] CLI error:", error);
	process.exit(1);
});
