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
import { TOOLS } from "./mcp/uris.js";

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
	const lines: string[] = [];

	// ── Analysis directive ────────────────────────────────────────────────────
	// Establishes how to work with tool results before listing the tools themselves.
	lines.push(
		"Nanostores tool results expose structural signals — hub scores, subscriber counts, mutator counts, chain depth, co-occurring pairs. Use them to identify which stores warrant investigation.",
		"",
		"For each store you investigate, Read the source file before stating findings:",
		"1. Use structural signals to form a hypothesis about the store's role and usage pattern",
		"2. Read the source file — understand what the store does in this project and whether the nanostores patterns used are appropriate for that purpose",
		"3. State what the structure reveals, what the source confirms or contradicts, and what their combination means for the codebase",
	);

	// ── Runtime analysis directive (only when logger active) ─────────────────
	if (loggerEnabled) {
		lines.push(
			"",
			"When runtime data is available, use it to validate and extend static findings:",
			`1. For each store flagged by ${TOOLS.findNoisyStores} or ${TOOLS.runtimeOverview}: call ${TOOLS.storeActivity} to get the event sequence`,
			"2. Distinguish externally triggered changes (user action → store change) from cascades (upstream source → this store via derives_from) — use storeImpact to trace the upstream root",
			`3. For stores with actionsErrored > 0: read the error message in ${TOOLS.storeActivity} events and the action handler source — these are bugs, not structural issues`,
			"4. Connect change frequency to user-visible behavior: what user gesture or async event triggers these changes?",
			`5. State findings as: "[Store] updates [N times per user gesture / per session] because [trigger]. This [is expected / suggests: batching, derived store, or finer-grained split]."`,
		);
	}

	// ── Docs analysis directive (only when docs active) ──────────────────────
	if (docsEnabled) {
		lines.push(
			"",
			`Docs are available via ${TOOLS.docsSearch} — use them to verify whether the patterns and store types you identify match recommended nanostores usage and to check for better alternatives.`,
		);
	}

	// ── Available tools ───────────────────────────────────────────────────────
	lines.push(
		"",
		"Available tools:",
		"1. Static analysis:",
		`   - ${TOOLS.scanProject} — discovers stores and dependency graph`,
		`   - ${TOOLS.storeSummary} — inspects individual stores`,
		`   - ${TOOLS.projectOutline} — quick high-level overview`,
		`   - ${TOOLS.storeSubgraph} — neighborhood around a specific store (BFS, both directions)`,
		`   - ${TOOLS.storeImpact} — causal impact chain: what recomputes if X changes?`,
	);

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

	// ── Request patterns → tool sequences ────────────────────────────────────
	lines.push(
		"",
		"Request patterns and tool sequences:",
		`- "Analyze / how is state structured?" → ${TOOLS.projectOutline} → follow investigation hints in the response → Read flagged source files`,
		`- "Why does $Component re-render?" → ${TOOLS.storeSummary} for each store it uses → ${TOOLS.storeImpact} → Read component and store source`,
		`- "What happens when [event / action]?" → identify the store that changes → ${TOOLS.storeImpact} → Read mutator source`,
		`- "Is any state unused / dead?" → ${TOOLS.projectOutline} → unreferencedStores section → Read source files before concluding`,
		`- "How is [auth / routing / sync] managed?" → ${TOOLS.scanProject}({compact: true}) → ${TOOLS.storeSummary} for relevant stores → Read source files`,
	);

	if (loggerEnabled) {
		lines.push(
			`- "Performance / why noisy updates?" → ${TOOLS.findNoisyStores} → ${TOOLS.storeActivity} (runtime events for one store) → ${TOOLS.storeImpact} → Read source`,
		);
	}

	if (docsEnabled) {
		lines.push(`- "How do I use [pattern]?" → ${TOOLS.docsSearch} → apply to flagged stores`);
	}

	// ── Structural signals ────────────────────────────────────────────────────
	lines.push(
		"",
		"Structural signals:",
		"- chain depth: longer derives_from chains mean more downstream recalculation per change.",
		"- fan-in: computed stores that depend on many sources recalculate once per source change.",
		`- unreferencedStores in ${TOOLS.projectOutline}: stores with no detected subscribers or derived dependents; includes mutatorCount, sfcFileReferences, and isPersistent signals.`,
		`- coOccurringPairs in ${TOOLS.projectOutline}: stores that consistently appear together in subscribers — candidates for consolidation or a shared derived store.`,
	);

	if (loggerEnabled) {
		lines.push(
			"- runtime change ratio: leaf-computed change count vs root-source change count measures downstream recalculation amplification per upstream event.",
			`- stores in static graph not observed in runtime session: check with ${TOOLS.runtimeCoverage}.`,
			`- actionsErrored > 0: always investigate — get events from ${TOOLS.storeActivity} and read the action handler source`,
			"- mounts > 1 on a module-level store (atom/map): unusual, may indicate re-initialization or duplicate logger attachment",
		);
	}

	// ── When investigating ────────────────────────────────────────────────────
	lines.push(
		"",
		"When a potential issue is found:",
		"- Read the source file of the store (file and line are in scan results) — structure shows the symptom, the file shows the intent.",
		`- Use ${TOOLS.storeSummary} or ${TOOLS.storeSubgraph} on flagged stores to see their full dependency context.`,
	);

	if (docsEnabled) {
		lines.push(
			`- Use ${TOOLS.docsSearch} for relevant optimization patterns (batched computed, setKey for maps, store composition).`,
		);
	}

	// ── Combined static + runtime pattern ─────────────────────────────────────
	if (loggerEnabled) {
		lines.push(
			"",
			"Combined static + runtime analysis pattern:",
			`1. ${TOOLS.projectOutline} → identify hubs and hot zones.`,
			`2. ${TOOLS.storeSummary} for each flagged hub → understand direct neighbors.`,
			`3. ${TOOLS.runtimeCoverage} → find gaps between static declarations and runtime events.`,
			`4. For flagged stores: ${TOOLS.storeActivity} (runtime details) + ${TOOLS.storeSubgraph} radius=1 (static impact).`,
			`5. ${TOOLS.findNoisyStores} → identify performance bottlenecks across the project.`,
			`6. ${TOOLS.scanProject} {compact: true} → directory-level view of all stores and subscribers.`,
		);
	}

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
