/**
 * Centralized MCP resource URIs
 * Single source of truth for all nanostores:// URIs
 */
export const URIS = {
	graph: "nanostores://graph",
	graphMermaid: "nanostores://graph/mermaid",

	storeTemplate: "nanostores://store/{key}",
	storeById: (id: string): string => `nanostores://store/${encodeURIComponent(id)}`,

	docsIndex: "nanostores://docs",
	docsPageTemplate: "nanostores://docs/page/{id}",
	docsPage: (id: string): string => `nanostores://docs/page/${encodeURIComponent(id)}`,
	docsSearch: "nanostores://docs/search",

	runtimeEvents: "nanostores://runtime/events",
	runtimeStats: "nanostores://runtime/stats",
	runtimeStoreTemplate: "nanostores://runtime/store/{key}",
} as const;
