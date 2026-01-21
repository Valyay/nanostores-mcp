/**
 * Centralized MCP resource URIs
 * Single source of truth for all nanostores:// URIs
 */
export const URIS = {
	graph: "nanostores://graph",
	graphOutline: "nanostores://graph/outline",
	graphMermaid: "nanostores://graph/mermaid",
	idDictionary: "nanostores://graph/id-dictionary",
	storeSubgraphBase: "nanostores://graph/store-subgraph",
	storeSubgraph: (storeId: string, radius = 2): string =>
		`nanostores://graph/store-subgraph?store=${encodeURIComponent(storeId)}&radius=${radius}`,

	storeTemplate: "nanostores://store/{key}",
	storeById: (id: string): string => `nanostores://store/${encodeURIComponent(id)}`,

	docsIndex: "nanostores://docs",
	docsPageTemplate: "nanostores://docs/page/{id}",
	docsPage: (id: string): string => `nanostores://docs/page/${encodeURIComponent(id)}`,
	docsSearch: "nanostores://docs/search",

	runtimeEvents: "nanostores://runtime/events",
	runtimeStats: "nanostores://runtime/stats",
	runtimeOverview: "nanostores://runtime/overview",
	runtimeStatsToon: "nanostores://runtime/stats-toon",
	runtimeEventsAggToon: "nanostores://runtime/events-agg-toon",
	runtimeStoreTemplate: "nanostores://runtime/store/{key}",
} as const;
