/**
 * Centralized MCP resource URIs
 * Single source of truth for all nanostores:// URIs
 */
export const URIS = {
	graph: "nanostores://graph",

	storeTemplate: "nanostores://store/{key}",
	storeById: (id: string): string => `nanostores://store/${encodeURIComponent(id)}`,

	docsIndex: "nanostores://docs",
	docsPageTemplate: "nanostores://docs/page/{id}",
	docsPage: (id: string): string => `nanostores://docs/page/${encodeURIComponent(id)}`,
} as const;

/**
 * Centralized MCP tool names
 * Single source of truth for all nanostores tool identifiers
 */
export const TOOLS = {
	scanProject: "nanostores_scan_project",
	storeSummary: "nanostores_store_summary",
	projectOutline: "nanostores_project_outline",
	storeSubgraph: "nanostores_store_subgraph",
	clearCache: "nanostores_clear_cache",
	runtimeOverview: "nanostores_runtime_overview",
	storeActivity: "nanostores_store_activity",
	findNoisyStores: "nanostores_find_noisy_stores",
	runtimeCoverage: "nanostores_runtime_coverage",
	docsSearch: "nanostores_docs_search",
	storeImpact: "nanostores_store_impact",
	ping: "nanostores_ping",
} as const;

/**
 * Centralized MCP prompt names
 * Single source of truth for all nanostores prompt identifiers
 */
export const PROMPTS = {
	explainProject: "explain-project",
	explainStore: "explain-store",
	debugStore: "debug-store",
	debugProjectActivity: "debug-project-activity",
	docsHowTo: "docs-how-to",
} as const;
