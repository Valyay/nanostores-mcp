import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	createProjectAnalysisService,
	createProjectIndexRepository,
	createRuntimeAnalysisService,
	createLoggerEventStore,
	createFsDocsSource,
	createDocsRepository,
	createDocsService,
} from "./domain/index.js";
import { createLoggerBridge } from "./logger/loggerBridge.js";
import { envConfig } from "./config/envConfig.js";
import { registerStaticFeatures } from "./features/static/index.js";
import { registerRuntimeFeatures } from "./features/runtime/index.js";
import { registerDocsFeatures } from "./features/docs/index.js";

import packageJson from "../package.json" with { type: "json" };

const SERVER_NAME = "nanostores-mcp";
const SERVER_VERSION = (packageJson as { version: string }).version;

// Domain services - project analysis
const projectIndexRepository = createProjectIndexRepository(30_000); // 30s cache
const projectAnalysisService = createProjectAnalysisService(projectIndexRepository);

// Domain services - runtime analysis
// Runtime repository (LoggerEventStore) - stores events from @nanostores/logger
const loggerEventStore = createLoggerEventStore(5000);
const loggerBridge = createLoggerBridge(loggerEventStore, {
	host: envConfig.NANOSTORES_MCP_LOGGER_HOST,
	port: envConfig.NANOSTORES_MCP_LOGGER_PORT,
	enabled: envConfig.NANOSTORES_MCP_LOGGER_ENABLED,
});

const runtimeAnalysisService = createRuntimeAnalysisService(
	loggerEventStore,
	projectAnalysisService,
	{
		activeThresholdMs: 5000,
		recentEventsLimit: 20,
	},
);

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

const docsService = docsRepository ? createDocsService(docsRepository) : null;

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

	// Register feature modules with domain services
	registerStaticFeatures(server, projectAnalysisService);
	registerRuntimeFeatures(server, runtimeAnalysisService, loggerBridge);
	registerDocsFeatures(server, docsService);

	return server;
}

// Cleanup on exit
process.on("SIGINT", () => {
	void loggerBridge.stop().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
	void loggerBridge.stop().then(() => process.exit(0));
});
