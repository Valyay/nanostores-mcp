import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DocsService } from "../../domain/index.js";
import type { StoreKind } from "../../domain/project/types.js";
import { DOCS_DISABLED_MESSAGE } from "../shared/consts.js";
import { TOOLS, URIS } from "../uris.js";

// Typed as StoreKind[] so adding a new variant to StoreKind without updating
// this array produces a compile-time error.
const STORE_KINDS: readonly StoreKind[] = [
	"atom",
	"map",
	"computed",
	"persistentAtom",
	"persistentMap",
	"atomFamily",
	"mapTemplate",
	"computedTemplate",
	"router",
	"i18n",
	"deepMap",
	"unknown",
];

const DocsSearchInputSchema = z.object({
	query: z
		.string()
		.optional()
		.describe("Search query for documentation. Required unless storeKind is provided."),
	storeKind: z
		.enum(STORE_KINDS)
		.optional()
		.describe("Find docs relevant to this store type. Can be used alone or with query."),
	limit: z.number().optional().default(10).describe("Maximum number of results"),
	tags: z.array(z.string()).optional().describe("Filter by tags (e.g., ['react', 'persistent'])"),
});

const DocsSearchOutputSchema = z.object({
	query: z.string().optional(),
	storeKind: z.string().optional(),
	results: z.array(
		z.object({
			pageId: z.string(),
			title: z.string(),
			url: z.string().optional(),
			headingPath: z.array(z.string()),
			snippet: z.string(),
			score: z.number(),
		}),
	),
});

/**
 * Tool: nanostores_docs_search
 * Single entry point for all Nanostores documentation lookup.
 *
 * Three modes:
 * - query only → full-text search
 * - storeKind only → tag-based page matching via findForStore()
 * - both → full-text search scoped to store-relevant pages
 */
export function registerDocsSearchTool(
	server: McpServer,
	getDocsService: () => DocsService | null,
): void {
	server.registerTool(
		TOOLS.docsSearch,
		{
			title: "Search Nanostores documentation",
			description:
				"Find Nanostores documentation by topic or store kind. " +
				"Use query for free-text search across guides, API references, and best practices. " +
				"Use storeKind to get docs relevant to a specific store type (atom, map, computed, etc.). " +
				"Combine both to search within store-relevant pages. " +
				"To read full page content, use the nanostores://docs/page/{id} resource.",
			inputSchema: DocsSearchInputSchema,
			outputSchema: DocsSearchOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ query, storeKind, limit, tags }) => {
			const docsService = getDocsService();
			if (!docsService) {
				return {
					content: [{ type: "text", text: DOCS_DISABLED_MESSAGE }],
					structuredContent: {
						query,
						storeKind,
						results: [],
					},
				};
			}

			if (!query && !storeKind) {
				return {
					content: [
						{
							type: "text",
							text: "Provide at least one of: query (text search) or storeKind (e.g., atom, map, computed).\n\nTo browse all available docs, read the nanostores://docs resource.",
						},
					],
					structuredContent: {
						results: [],
					},
				};
			}

			try {
				type ResultEntry = {
					pageId: string;
					title: string;
					url?: string;
					headingPath: string[];
					snippet: string;
					score: number;
				};

				let results: ResultEntry[];

				if (query) {
					// Scope search to store-relevant pages when storeKind provided
					let pageIds: string[] | undefined;
					if (storeKind) {
						const storePages = await docsService.findForStore(storeKind);
						pageIds = storePages.map(p => p.id);
					}
					const searchResult = await docsService.search(query, { limit, tags, pageIds });
					results = searchResult.hits.map(hit => ({
						pageId: hit.page.id,
						title: hit.page.title,
						url: hit.page.url,
						headingPath: hit.chunk.headingPath,
						snippet: hit.chunk.text.slice(0, 200).replace(/\n/g, " "),
						score: hit.score,
					}));
				} else {
					// storeKind only: tag-based page matching
					const storePages = await docsService.findForStore(storeKind!);
					results = storePages.slice(0, limit).map((page, i) => ({
						pageId: page.id,
						title: page.title,
						url: page.url,
						headingPath: [],
						snippet: page.summary ?? page.title,
						score: storePages.length - i,
					}));
				}

				// Build text summary
				let summary: string;
				if (results.length === 0) {
					summary = "No documentation found";
					if (query) summary += ` for "${query}"`;
					if (storeKind) summary += ` (kind: ${storeKind})`;
					summary += ".\n\nTry browsing the nanostores://docs resource.";
				} else {
					summary = `Found ${results.length} results`;
					if (query) summary += ` for "${query}"`;
					if (storeKind) summary += ` (kind: ${storeKind})`;
					if (tags) summary += ` [tags: ${tags.join(", ")}]`;
					summary += "\n\n";

					for (const [i, res] of results.entries()) {
						summary += `${i + 1}. ${res.title}`;
						if (res.headingPath.length > 0) {
							summary += ` > ${res.headingPath.join(" > ")}`;
						}
						summary += `\n   ${res.snippet}`;
						summary += `\n   [Read: ${URIS.docsPage(res.pageId)}]\n\n`;
					}
				}

				return {
					content: [{ type: "text", text: summary }],
					structuredContent: { query, storeKind, results },
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to search documentation.\n\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}
