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
		"Nanostores tool results expose structural signals — hub scores, subscriber counts, mutator counts, chain depth, co-occurring pairs, and store flags. Use them to identify which stores warrant investigation.",
		"",
		"Store flags (computedHasSideEffects, computedHasCleanupCalls, isInsideFactory, readViaGetOnly, storyOrTestOnlyWriter, etc.) are observational signals, not conclusions.",
		"Use them to prioritize investigation. Validate with source code or additional structural evidence before making a strong claim.",
		"If not validated, present as a possibility — not as a finding.",
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

	// ── Tool selection heuristics ─────────────────────────────────────────────
	lines.push(
		"",
		"Tool selection heuristics:",
		`- For topology / architecture questions (how is state structured, what depends on what): prefer graph-level tools first (${TOOLS.projectOutline}, ${TOOLS.storeSummary}, ${TOOLS.storeSubgraph}). Read source files only to validate or explain suspicious findings.`,
		`- For causal questions (what recomputes when X changes, why does Y re-render): use ${TOOLS.storeImpact} on the root store before reading source.`,
		`- For dead code questions (unused stores): ${TOOLS.projectOutline} unreferencedStores — treat signals (mutatorCount, sfcFileReferences, isPersistent) as hypotheses, not conclusions. Read the source file before concluding.`,
		`- For unfamiliar codebases or broad scans: ${TOOLS.scanProject}({compact: true}) gives a directory-level overview without full store lists.`,
	);

	if (loggerEnabled) {
		lines.push(
			`- For performance questions (noisy updates, excess re-renders): ${TOOLS.findNoisyStores} → ${TOOLS.storeActivity} → ${TOOLS.storeImpact} → read source. Distinguish cascades (upstream store → this store) from external triggers (user action → store).`,
		);
	}

	if (docsEnabled) {
		lines.push(
			`- For pattern questions (how to use X, is this idiomatic): ${TOOLS.docsSearch} first, then apply to flagged stores.`,
		);
	}

	// ── Structural signals ────────────────────────────────────────────────────
	lines.push(
		"",
		"Structural signals:",
		"- chain depth: longer derives_from chains mean more downstream recalculation per change.",
		"- fan-in: computed stores that depend on many sources recalculate once per source change.",
		`- unreferencedStores in ${TOOLS.projectOutline}: stores with no detected subscribers or derived dependents; includes mutatorCount, sfcFileReferences, and isPersistent signals.`,
		`- coOccurringPairs in ${TOOLS.projectOutline}: stores that consistently appear together in subscribers — candidates for consolidation or a shared derived store.`,
		"",
		"Semantic flags on stores (appear in store_summary output under flags):",
		"- computedHasSideEffects: computed callback calls .set/.subscribe/setTimeout/etc — read source before assuming pure derivation.",
		"- computedHasCleanupCalls: computed callback calls .destroy() — typical lifecycle pattern, distinct from state mutation side effects.",
		"- isInsideFactory: store declared inside a function body — may be per-instance, not shared global state.",
		"- hasMountDependentActivation: onMount() detected — behavior only activates when the store has live subscribers.",
		"- writtenWithoutSubscribers: mutators exist but no reactive subscribers detected — may be imperative-only config, dead code, or subscribers hidden from static analysis (onMount, onSet, keepMount).",
		"- readViaGetOnly: only .get() calls detected, no useStore/subscribe — imperative access pattern. Not necessarily dead — could be a service or utility reading state outside the reactive graph.",
		"- storyOrTestOnlyWriter: all detected mutations come from test/story files — store is not written in production code. Strong signal for test-only or mock state.",
	);

	if (loggerEnabled) {
		lines.push(
			"- runtime change ratio: leaf-computed change count vs root-source change count measures downstream recalculation amplification per upstream event.",
			`- stores in static graph not observed in runtime session: check with ${TOOLS.runtimeCoverage}.`,
			`- actionsErrored > 0: always investigate — get events from ${TOOLS.storeActivity} and read the action handler source`,
			"- mounts > 1 on a module-level store (atom/map): unusual, may indicate re-initialization or duplicate logger attachment",
		);
	}

	// ── Static analysis blind spots ───────────────────────────────────────────
	// List of known gaps in static detection. Remove each item when the scanner is fixed.
	lines.push(
		"",
		"Static analysis blind spots — the scanner cannot detect these patterns. Adjust confidence accordingly:",
		"",
		"Subscriptions not detected:",
		"- onMount($store, callback) and onSet($store, callback): nanostores lifecycle hooks are not counted as subscribers. A store with zero detected subscribers may still be actively used via these hooks.",
		"- keepMount($store): forces a store to stay mounted; invisible to the subscriber graph.",
		"- $store.get() inside intervals or render loops counts as readViaGetOnly — polling-style reads are detected as imperative access but not as reactive subscriptions.",
		"",
		"Store declarations not detected:",
		"- Stores returned from factory functions and captured via destructuring: `const { $x } = createFoo()` — $x is not linked to the atom() call inside createFoo, so it will not appear in the store index.",
		"- atomFamily(id) and mapTemplate(id) call sites: each call creates a store instance at runtime, but instances are not tracked. Only the family/template declaration itself is indexed.",
		"- Dynamic imports: `await import('./stores')` — stores from async-loaded modules are not scanned.",
		"- CommonJS require(): `const { atom } = require('nanostores')` — only ESM import declarations are parsed.",
		"- Default import style: `import ns from 'nanostores'` is not recognized; only named imports and `import * as ns` are detected.",
		"",
		"Dependency edges not detected:",
		"- atomFamily / mapTemplate / computedTemplate derives_from edges are intentionally excluded (incomplete dependency semantics). Chains passing through template stores are invisible.",
		"- onSet($a, () => $b.set(...)) reactive chains: side-effect-driven store-to-store dependencies do not appear as derives_from edges.",
		"",
		"Mutation attribution gaps:",
		"- batch(() => { $a.set(); $b.set() }): individual .set() calls are detected, but the batch boundary is invisible — related mutations are not grouped.",
		"- Indirect mutations via wrapper functions: `function updateUser(v) { $user.set(v) }` — the call site of updateUser() is not attributed to $user.",
	);

	if (loggerEnabled) {
		lines.push(
			`Use ${TOOLS.runtimeCoverage} to cross-check: stores present at runtime but absent in the static index are likely factory-created or loaded dynamically.`,
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
