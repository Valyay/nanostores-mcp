import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPingTool } from "./mcp/tools/ping.js";
import { registerScanProjectTool } from "./mcp/tools/scanProject.js";
import { registerStoreResource } from "./mcp/resources/store.js";
import { registerGraphResource } from "./mcp/resources/graph.js";
import { registerGraphMermaidResource } from "./mcp/resources/graphMermaid.js";
import { registerExplainProjectPrompt } from "./mcp/prompts/explainProject.js";
import { registerStoreSummaryTool } from "./mcp/tools/storeSummary.js";
import { registerExplainStorePrompt } from "./mcp/prompts/explainStore.js";

// Logger integration
import { createLoggerEventStore } from "./domain/loggerEventStore.js";
import { createLoggerBridge } from "./logger/loggerBridge.js";
import { envConfig } from "./config/envConfig.js";
import {
	registerRuntimeEventsResource,
	registerRuntimeStatsResource,
	registerRuntimeStoreResource,
} from "./mcp/resources/runtime.js";
import {
	registerStoreActivityTool,
	registerFindNoisyStoresTool,
	registerRuntimeOverviewTool,
} from "./mcp/tools/runtime.js";
import {
	registerDebugStorePrompt,
	registerDebugProjectActivityPrompt,
} from "./mcp/prompts/debugRuntime.js";

// Documentation integration
import { createFsDocsSource } from "./domain/docsSourceFs.js";
import { createDocsRepository } from "./domain/docsIndex.js";
import {
	registerDocsIndexResource,
	registerDocsPageResource,
	registerDocsSearchResource,
} from "./mcp/resources/docs.js";
import { registerDocsSearchTool, registerDocsForStoreTool } from "./mcp/tools/docs.js";
import { registerDocsHowToPrompt } from "./mcp/prompts/docsHowTo.js";

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

	// tools
	registerPingTool(server, loggerBridge);
	registerScanProjectTool(server);
	registerStoreSummaryTool(server);

	// runtime tools
	registerStoreActivityTool(server, loggerEventStore);
	registerFindNoisyStoresTool(server, loggerEventStore);
	registerRuntimeOverviewTool(server, loggerEventStore);

	// resources
	registerStoreResource(server);
	registerGraphResource(server);
	registerGraphMermaidResource(server);

	// runtime resources
	registerRuntimeEventsResource(server, loggerEventStore);
	registerRuntimeStatsResource(server, loggerEventStore);
	registerRuntimeStoreResource(server, loggerEventStore);

	// documentation resources
	if (docsRepository) {
		registerDocsIndexResource(server, docsRepository);
		registerDocsPageResource(server, docsRepository);
		registerDocsSearchResource(server, docsRepository);
	}

	// documentation tools
	if (docsRepository) {
		registerDocsSearchTool(server, docsRepository);
		registerDocsForStoreTool(server, docsRepository);
	}

	// prompts
	registerExplainProjectPrompt(server);
	registerExplainStorePrompt(server);

	// runtime prompts
	registerDebugStorePrompt(server);
	registerDebugProjectActivityPrompt(server);

	// documentation prompts
	if (docsRepository) {
		registerDocsHowToPrompt(server);
	}

	return server;
}

// Cleanup on exit
process.on("SIGINT", () => {
	void loggerBridge.stop().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
	void loggerBridge.stop().then(() => process.exit(0));
});
