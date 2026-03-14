import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	createProjectAnalysisService,
	createProjectIndexRepository,
	createRuntimeAnalysisService,
	createLoggerEventStore,
	createDocsRepository,
	createDocsService,
	detectNanostoresDocsSource,
} from "./domain/index.js";
import { createLoggerBridge } from "./logger/loggerBridge.js";
import { envConfig } from "./config/envConfig.js";
import { getWorkspaceRootPaths } from "./config/settings.js";
import { registerStaticFeatures } from "./features/static/index.js";
import { registerRuntimeFeatures } from "./features/runtime/index.js";
import { registerDocsFeatures } from "./features/docs/index.js";
import { registerPingTool } from "./mcp/tools/ping.js";
import { createStoreAutocomplete } from "./mcp/shared/storeAutocomplete.js";

import packageJson from "../package.json" with { type: "json" };

const SERVER_NAME = "nanostores-mcp";
const SERVER_VERSION = (packageJson as { version: string }).version;

// Track server instance for notifications and graceful shutdown
let activeServer: McpServer | null = null;

// Domain services - project analysis
const projectIndexRepository = createProjectIndexRepository();
const projectAnalysisService = createProjectAnalysisService(projectIndexRepository);

// Domain services - runtime analysis
// Runtime repository (LoggerEventStore) - stores events from @nanostores/logger
const loggerEventStore = createLoggerEventStore(5000);
const loggerBridge = createLoggerBridge(loggerEventStore, {
	host: envConfig.NANOSTORES_MCP_LOGGER_HOST,
	port: envConfig.NANOSTORES_MCP_LOGGER_PORT,
	enabled: envConfig.NANOSTORES_MCP_LOGGER_ENABLED,
	onEventsReceived: () => {
		activeServer?.sendResourceListChanged();
	},
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
	loggerBridge.start().catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[nanostores-mcp] Logger bridge failed to start: ${message}\n`);
	});
}

// Global documentation infrastructure (auto-detect or env override)
const { source: docsSource } = detectNanostoresDocsSource({
	workspaceRoots: getWorkspaceRootPaths(),
	envDocsRoot: envConfig.NANOSTORES_DOCS_ROOT,
	envPatterns: envConfig.NANOSTORES_DOCS_PATTERNS,
});

const docsRepository = docsSource
	? createDocsRepository(docsSource, { cacheTtlMs: 5 * 60 * 1000 })
	: undefined;

const docsService = docsRepository ? createDocsService(docsRepository) : null;

/**
 * Build the server instructions string sent to LLM clients during initialization.
 * Conditionally includes sections for enabled features to avoid mentioning disabled tools.
 */
function buildInstructions(): string {
	const lines = [
		"Analyzes Nanostores state management via layered approach:",
		"1. Static analysis: nanostores_scan_project discovers stores and dependency graph; nanostores_store_summary inspects individual stores.",
	];

	if (envConfig.NANOSTORES_MCP_LOGGER_ENABLED) {
		lines.push(
			"2. Runtime monitoring (active): nanostores_runtime_overview for health, nanostores_store_activity for per-store events, nanostores_find_noisy_stores for performance hotspots.",
		);
	}

	if (docsService) {
		lines.push(
			`${envConfig.NANOSTORES_MCP_LOGGER_ENABLED ? "3" : "2"}. Documentation: nanostores_docs_search for guides and API references.`,
		);
	}

	lines.push(
		"Start with nanostores_scan_project. Use prompts (explain-project, explain-store, debug-store, docs-how-to) for guided analysis.",
	);

	return lines.join("\n");
}

export function buildNanostoresServer(): McpServer {
	const server = new McpServer(
		{
			name: SERVER_NAME,
			version: SERVER_VERSION,
			description:
				"Static AST analysis and optional runtime monitoring for Nanostores state management",
		},
		{
			capabilities: {
				logging: {},
				tools: {},
				resources: { listChanged: true },
				prompts: {},
			},
			instructions: buildInstructions(),
		},
	);

	// Create shared autocomplete bound to the project analysis service
	const { suggestStoreNames, resetCache: resetAutocompleteCache } =
		createStoreAutocomplete(projectAnalysisService);

	const notifyResourcesChanged = (): void => {
		server.sendResourceListChanged();
	};

	// Register feature modules with domain services
	registerStaticFeatures(
		server,
		projectAnalysisService,
		suggestStoreNames,
		resetAutocompleteCache,
		notifyResourcesChanged,
	);
	registerPingTool(server, loggerBridge);
	if (envConfig.NANOSTORES_MCP_LOGGER_ENABLED) {
		registerRuntimeFeatures(server, runtimeAnalysisService, suggestStoreNames);
	}
	registerDocsFeatures(server, docsService);

	activeServer = server;
	return server;
}

async function gracefulShutdown(): Promise<void> {
	await Promise.allSettled([activeServer?.close(), loggerBridge.stop()]);
	process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());
