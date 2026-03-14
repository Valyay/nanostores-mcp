import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsService } from "./domain/index.js";
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
import type { LoggerBridgeServer } from "./logger/loggerBridge.js";
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

export interface NanostoresServer {
	server: McpServer;
	loggerBridge: LoggerBridgeServer;
	shutdown: () => Promise<void>;
	reinitializeDocs: () => void;
}

/**
 * Build the server instructions string sent to LLM clients during initialization.
 * Conditionally includes sections for enabled features to avoid mentioning disabled tools.
 */
function buildInstructions(
	loggerEnabled: boolean,
	docsEnabled: boolean,
): string {
	const lines = [
		"Analyzes Nanostores state management via layered approach:",
		"1. Static analysis: nanostores_scan_project discovers stores and dependency graph; nanostores_store_summary inspects individual stores.",
	];

	if (loggerEnabled) {
		lines.push(
			"2. Runtime monitoring (active): nanostores_runtime_overview for health, nanostores_store_activity for per-store events, nanostores_find_noisy_stores for performance hotspots.",
		);
	}

	if (docsEnabled) {
		lines.push(
			`${loggerEnabled ? "3" : "2"}. Documentation: nanostores_docs_search for guides and API references.`,
		);
	}

	lines.push(
		"Start with nanostores_scan_project. Use prompts (explain-project, explain-store, debug-store, docs-how-to) for guided analysis.",
	);

	return lines.join("\n");
}

/**
 * Build the Nanostores MCP server with all domain services and features.
 * Pure factory — no side effects, no signal handlers, no bridge startup.
 */
export function buildNanostoresServer(): NanostoresServer {
	// Domain services - project analysis
	const projectIndexRepository = createProjectIndexRepository();
	const projectAnalysisService = createProjectAnalysisService(projectIndexRepository);

	// Domain services - runtime analysis
	const loggerEventStore = createLoggerEventStore(5000);
	const runtimeAnalysisService = createRuntimeAnalysisService(
		loggerEventStore,
		projectAnalysisService,
		{
			activeThresholdMs: 5000,
			recentEventsLimit: 20,
		},
	);

	// Documentation infrastructure — lazy, re-detects when workspace roots change
	let docsService: DocsService | null = null;
	let docsInitialized = false;

	function initializeDocs(): void {
		const { source: docsSource } = detectNanostoresDocsSource({
			workspaceRoots: getWorkspaceRootPaths(),
			envDocsRoot: envConfig.NANOSTORES_DOCS_ROOT,
			envPatterns: envConfig.NANOSTORES_DOCS_PATTERNS,
		});

		const docsRepository = docsSource
			? createDocsRepository(docsSource, { cacheTtlMs: 5 * 60 * 1000 })
			: undefined;

		docsService = docsRepository ? createDocsService(docsRepository) : null;
		docsInitialized = true;
	}

	function getDocsService(): DocsService | null {
		if (!docsInitialized) {
			initializeDocs();
		}
		return docsService;
	}

	// MCP server
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
			instructions: buildInstructions(envConfig.NANOSTORES_MCP_LOGGER_ENABLED, !!getDocsService()),
		},
	);

	// Logger bridge (created after server so notifications work immediately)
	const loggerBridge = createLoggerBridge(loggerEventStore, {
		host: envConfig.NANOSTORES_MCP_LOGGER_HOST,
		port: envConfig.NANOSTORES_MCP_LOGGER_PORT,
		enabled: envConfig.NANOSTORES_MCP_LOGGER_ENABLED,
		onEventsReceived: () => {
			try {
				server.sendResourceListChanged();
			} catch {
				// Best-effort: server may not be connected yet
			}
		},
	});

	// Shared autocomplete
	const { suggestStoreNames, resetCache: resetAutocompleteCache } =
		createStoreAutocomplete(projectAnalysisService);

	const notifyResourcesChanged = (): void => {
		server.sendResourceListChanged();
	};

	// Register feature modules
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
	registerDocsFeatures(server, getDocsService);

	// Shutdown helper
	async function shutdown(): Promise<void> {
		await Promise.allSettled([server.close(), loggerBridge.stop()]);
	}

	return { server, loggerBridge, shutdown, reinitializeDocs: initializeDocs };
}
