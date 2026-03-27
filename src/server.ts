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
import { TOOLS, PROMPTS } from "./mcp/uris.js";

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
export function buildInstructions(loggerEnabled: boolean, docsEnabled: boolean): string {
	const lines = [
		"Analyzes Nanostores state management via layered approach:",
		"1. Static analysis:",
		`   - ${TOOLS.scanProject} — discovers stores and dependency graph`,
		`   - ${TOOLS.storeSummary} — inspects individual stores`,
		`   - ${TOOLS.projectOutline} — quick high-level overview`,
		`   - ${TOOLS.storeSubgraph} — impact analysis around a specific store`,
	];

	if (loggerEnabled) {
		lines.push(
			"2. Runtime monitoring (active):",
			`   - ${TOOLS.runtimeOverview} — health overview`,
			`   - ${TOOLS.storeActivity} — per-store events`,
			`   - ${TOOLS.findNoisyStores} — performance hotspots`,
			`   - ${TOOLS.runtimeCoverage} — static vs runtime store comparison`,
		);
	}

	if (docsEnabled) {
		lines.push(
			`${loggerEnabled ? "3" : "2"}. Documentation:`,
			`   - ${TOOLS.docsSearch} — guides and API references`,
		);
	}

	// Tool selection guide
	lines.push(
		"",
		"Tool selection guide:",
		`- "What stores exist?" → ${TOOLS.projectOutline} (compact summary) or ${TOOLS.scanProject} (full list)`,
		`- "Tell me about $store" → ${TOOLS.storeSummary} (direct neighbors)`,
		`- "What depends on / is affected by $store?" → ${TOOLS.storeSubgraph} (multi-hop impact chain)`,
	);

	if (loggerEnabled) {
		lines.push(
			`- "Why is $store updating so often?" → ${TOOLS.storeActivity} (runtime events for one store)`,
			`- "Any performance issues?" → ${TOOLS.findNoisyStores} then ${TOOLS.storeActivity} for details`,
			`- "Is everything instrumented?" → ${TOOLS.runtimeCoverage} (static vs runtime gaps)`,
		);
	}

	if (docsEnabled) {
		lines.push(
			`- "How do I use computed stores?" → ${TOOLS.docsSearch} with query or storeKind`,
		);
	}

	// Diagnostic workflow
	lines.push(
		"",
		"Diagnostic workflow after scanning:",
		"- Check computed chain depth via derives_from edges; longer chains increase the number of recalculations per change — consider whether intermediate stores are necessary.",
		"- Identify fan-in hotspots: computed stores depending on many other stores get recalculated once per dependency change.",
		"- Stores in static graph but never used by any subscriber may indicate dead code.",
	);

	if (loggerEnabled) {
		lines.push(
			"- Compare runtime change counts between leaf computed and root sources; a higher ratio may indicate cascade amplification worth investigating.",
			`- Stores in static graph but absent from runtime may be dead code or missing instrumentation — use ${TOOLS.runtimeCoverage} to check.`,
		);
	}

	lines.push(
		"",
		"When a potential issue is found:",
		`- Use ${TOOLS.storeSummary} or ${TOOLS.storeSubgraph} on flagged stores to see their full dependency context.`,
		"- Read the source file of the store (file and line are in scan results) to understand the computation logic and assess whether the structure is necessary.",
	);

	if (docsEnabled) {
		lines.push(
			`- Use ${TOOLS.docsSearch} for relevant optimization patterns (batched computed, setKey for maps, store composition).`,
		);
	}

	// Combined analysis pattern (static + runtime)
	if (loggerEnabled) {
		lines.push(
			"",
			"Combined static + runtime analysis pattern:",
			`1. ${TOOLS.scanProject} → build the store dependency graph.`,
			`2. ${TOOLS.runtimeCoverage} → find gaps between static declarations and runtime events.`,
			`3. For flagged stores: ${TOOLS.storeActivity} (runtime details) + ${TOOLS.storeSubgraph} (static impact).`,
			`4. ${TOOLS.findNoisyStores} → identify performance bottlenecks across the project.`,
		);
	}

	lines.push(
		"",
		`Start with ${TOOLS.projectOutline} for a quick overview or ${TOOLS.scanProject} for full data. Use prompts (${PROMPTS.explainProject}, ${PROMPTS.explainStore}, ${PROMPTS.debugStore}, ${PROMPTS.docsHowTo}) for guided analysis.`,
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
			} catch (err) {
				// Best-effort: server may not be connected yet
				process.stderr.write(
					`[nanostores-mcp] sendResourceListChanged failed: ${err instanceof Error ? err.message : String(err)}\n`,
				);
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
