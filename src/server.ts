import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLoggerEventStore } from "./domain/loggerEventStore.js";
import { createLoggerBridge } from "./logger/loggerBridge.js";
import { envConfig } from "./config/envConfig.js";
import { createFsDocsSource } from "./domain/docsSourceFs.js";
import { createDocsRepository } from "./domain/docsIndex.js";
import { registerStaticFeatures } from "./features/static/index.js";
import { registerRuntimeFeatures } from "./features/runtime/index.js";
import { registerDocsFeatures } from "./features/docs/index.js";

import packageJson from "../package.json" with { type: "json" };

const SERVER_NAME = "nanostores-mcp";
const SERVER_VERSION = (packageJson as { version: string }).version;

// Global logger infrastructure
const loggerEventStore = createLoggerEventStore(5000);
const loggerBridge = createLoggerBridge(loggerEventStore, {
	host: envConfig.NANOSTORES_MCP_LOGGER_HOST,
	port: envConfig.NANOSTORES_MCP_LOGGER_PORT,
	enabled: envConfig.NANOSTORES_MCP_LOGGER_ENABLED,
});

// Start logger bridge if enabled
if (envConfig.NANOSTORES_MCP_LOGGER_ENABLED) {
	loggerBridge.start().catch(() => {
		// Silent fail - bridge is optional
	});
}

// Global documentation infrastructure
const docsSource = envConfig.NANOSTORES_DOCS_ROOT
	? createFsDocsSource({
			rootDir: envConfig.NANOSTORES_DOCS_ROOT,
			patterns: envConfig.NANOSTORES_DOCS_PATTERNS,
		})
	: undefined;

const docsRepository = docsSource
	? createDocsRepository(docsSource, { cacheTtlMs: 5 * 60 * 1000 })
	: undefined;

export function buildNanostoresServer(): McpServer {
	const server = new McpServer(
		{
			name: SERVER_NAME,
			version: SERVER_VERSION,
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				prompts: {},
			},
		},
	);

	// Register feature modules
	registerStaticFeatures(server);
	registerRuntimeFeatures(server, loggerEventStore, loggerBridge);
	registerDocsFeatures(server, docsRepository ?? null);

	return server;
}

// Cleanup on exit
process.on("SIGINT", () => {
	void loggerBridge.stop().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
	void loggerBridge.stop().then(() => process.exit(0));
});
