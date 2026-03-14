import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { DocsService, DocPage } from "../../domain/index.js";
import { DOCS_DISABLED_MESSAGE } from "../shared/consts.js";
import { aggregateTags } from "../shared/docsHelpers.js";
import { URIS } from "../uris.js";

// ── nanostores_docs_read_page ─────────────────────────────────────────────────

const DocsReadPageInputSchema = z.object({
	pageId: z.string().describe("Page ID (e.g., 'guide/atom'). Use nanostores_docs_index to list."),
});

const DocsReadPageOutputSchema = z.object({
	title: z.string(),
	tags: z.array(z.string()),
	url: z.string().optional(),
	filePath: z.string(),
	summary: z.string().optional(),
	content: z.string(),
});

/**
 * Tool: nanostores_docs_read_page
 * Read the full content of a documentation page
 */
export function registerDocsReadPageTool(server: McpServer, docsService: DocsService | null): void {
	server.registerTool(
		"nanostores_docs_read_page",
		{
			title: "Read a documentation page",
			description:
				"Use this after nanostores_docs_search to read the full content of a documentation page. " +
				"Returns the complete page text with metadata.",
			inputSchema: DocsReadPageInputSchema,
			outputSchema: DocsReadPageOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ pageId }) => {
			if (!docsService) {
				return {
					content: [{ type: "text", text: DOCS_DISABLED_MESSAGE }],
					structuredContent: {
						title: "",
						tags: [],
						filePath: "",
						content: DOCS_DISABLED_MESSAGE,
					},
				};
			}

			try {
				const page = await docsService.getPage(pageId);

				if (!page) {
					throw new McpError(
						ErrorCode.InvalidParams,
						`Page not found: ${pageId}. Use nanostores_docs_index to see available pages.`,
					);
				}

				const chunks = await docsService.getPageChunks(pageId);
				const fullText = chunks.map(c => c.text).join("\n\n");

				const summary = `# ${page.title}\n\nTags: ${page.tags.join(", ")}${page.url ? `\nURL: ${page.url}` : ""}\n\n---\n\n${fullText}`;

				const output = {
					title: page.title,
					tags: page.tags,
					url: page.url,
					filePath: page.filePath,
					summary: page.summary,
					content: fullText,
				};

				return {
					content: [{ type: "text", text: summary }],
					structuredContent: output,
					resourceLinks: [{ uri: URIS.docsPage(pageId) }],
				};
			} catch (error) {
				if (error instanceof McpError) throw error;
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to read documentation page.\n\nPage: ${pageId}\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}

// ── nanostores_docs_index ─────────────────────────────────────────────────────

const DocsIndexInputSchema = z.object({});

const DocsIndexOutputSchema = z.object({
	pages: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			tags: z.array(z.string()),
			url: z.string().optional(),
		}),
	),
	tagAggregation: z.array(
		z.object({
			tag: z.string(),
			count: z.number(),
		}),
	),
	builtAt: z.number(),
});

/**
 * Tool: nanostores_docs_index
 * List all documentation pages and tags
 */
export function registerDocsIndexTool(server: McpServer, docsService: DocsService | null): void {
	server.registerTool(
		"nanostores_docs_index",
		{
			title: "List documentation pages",
			description:
				"Use this to discover available Nanostores documentation pages and topics. " +
				"Returns page metadata and tag aggregation without full content.",
			inputSchema: DocsIndexInputSchema,
			outputSchema: DocsIndexOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			if (!docsService) {
				return {
					content: [{ type: "text", text: DOCS_DISABLED_MESSAGE }],
					structuredContent: {
						pages: [],
						tagAggregation: [],
						builtAt: 0,
					},
				};
			}

			try {
				const index = await docsService.getIndex();

				const pages = index.pages.map(p => ({
					id: p.id,
					title: p.title,
					tags: p.tags,
					url: p.url,
				}));

				const tagAggregation = aggregateTags(index.pages);

				let summary = `Nanostores Documentation Index\n\n`;
				summary += `Pages: ${pages.length}\n`;
				summary += `Built: ${new Date(index.builtAt).toISOString()}\n\n`;
				summary += `Tags:\n`;
				for (const { tag, count } of tagAggregation) {
					summary += `- ${tag}: ${count} pages\n`;
				}
				summary += `\nPages:\n`;
				for (const p of pages) {
					summary += `- ${p.title} (${p.id})\n`;
				}

				const output = { pages, tagAggregation, builtAt: index.builtAt };

				return {
					content: [{ type: "text", text: summary }],
					structuredContent: output,
					resourceLinks: [{ uri: URIS.docsIndex }],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to load documentation index.\n\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}

const DocsSearchInputSchema = z.object({
	query: z.string().describe("Search query for documentation"),
	limit: z.number().optional().default(10).describe("Maximum number of results"),
	tags: z.array(z.string()).optional().describe("Filter by tags (e.g., ['react', 'persistent'])"),
});

const DocsSearchOutputSchema = z.object({
	query: z.string(),
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
 * Search Nanostores documentation
 */
export function registerDocsSearchTool(server: McpServer, docsService: DocsService | null): void {
	server.registerTool(
		"nanostores_docs_search",
		{
			title: "Search Nanostores documentation",
			description:
				"Use this when you need to look up Nanostores API usage, patterns, or best practices. " +
				"Returns matching documentation snippets and page references.",
			inputSchema: DocsSearchInputSchema,
			outputSchema: DocsSearchOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ query, limit, tags }) => {
			if (!docsService) {
				return {
					content: [
						{
							type: "text",
							text: DOCS_DISABLED_MESSAGE,
						},
					],
					structuredContent: {
						query,
						results: [],
					},
				};
			}

			try {
				const result = await docsService.search(query, { limit, tags });

				const results = result.hits.map(hit => ({
					pageId: hit.page.id,
					title: hit.page.title,
					url: hit.page.url,
					headingPath: hit.chunk.headingPath,
					snippet: hit.chunk.text.slice(0, 200).replace(/\n/g, " "),
					score: hit.score,
				}));

				let summary = `Found ${results.length} results for "${query}"`;
				if (tags) summary += ` (tags: ${tags.join(", ")})`;
				summary += "\n\n";

				for (const [i, res] of results.entries()) {
					summary += `${i + 1}. ${res.title}`;
					if (res.headingPath.length > 0) {
						summary += ` > ${res.headingPath.join(" > ")}`;
					}
					summary += `\n   ${res.snippet}...\n`;
					summary += `   [Read more: ${URIS.docsPage(res.pageId)}]\n\n`;
				}

				const output = {
					query,
					results,
				};

				return {
					content: [
						{
							type: "text",
							text: summary,
						},
					],
					structuredContent: output,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to search documentation.\n\nQuery: ${query}\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}

const DocsForStoreInputSchema = z.object({
	storeName: z.string().describe("Store name to find documentation for"),
	kindHint: z
		.enum(["atom", "map", "computed", "persistent"])
		.optional()
		.describe("Store kind hint"),
});

const DocsForStoreOutputSchema = z.object({
	storeName: z.string(),
	kind: z.string().optional(),
	relevantDocs: z.array(
		z.object({
			pageId: z.string(),
			title: z.string(),
			url: z.string().optional(),
			reason: z.string(),
		}),
	),
});

/**
 * Tool: nanostores_docs_for_store
 * Find relevant documentation for a specific store
 */
export function registerDocsForStoreTool(server: McpServer, docsService: DocsService | null): void {
	server.registerTool(
		"nanostores_docs_for_store",
		{
			title: "Find docs for store",
			description:
				"Use this when you have a specific store and want documentation relevant to its type " +
				"(atom, map, computed, etc.) and usage patterns.",
			inputSchema: DocsForStoreInputSchema,
			outputSchema: DocsForStoreOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ storeName, kindHint }) => {
			if (!docsService) {
				return {
					content: [
						{
							type: "text",
							text: DOCS_DISABLED_MESSAGE,
						},
					],
					structuredContent: {
						storeName,
						kind: kindHint,
						relevantDocs: [],
					},
				};
			}

			try {
				// Build search query based on store kind
				const queries: string[] = [];
				if (kindHint === "atom") {
					queries.push("atom primitive value", "createAtom");
				} else if (kindHint === "map") {
					queries.push("map object store", "createMap");
				} else if (kindHint === "computed") {
					queries.push("computed derived", "computed store");
				} else if (kindHint === "persistent") {
					queries.push("persistent localStorage", "persistentAtom persistentMap");
				} else {
					queries.push("store best practices");
				}

				// Always add general best practices
				queries.push("best practices patterns");

				const allResults = new Map<string, { page: DocPage; score: number; reason: string }>();

				for (const query of queries) {
					const result = await docsService.search(query, { limit: 3 });

					for (const hit of result.hits) {
						const existing = allResults.get(hit.page.id);
						if (!existing || existing.score < hit.score) {
							allResults.set(hit.page.id, {
								page: hit.page,
								score: hit.score,
								reason: `Matched query "${query}"`,
							});
						}
					}
				}

				const relevantDocs = Array.from(allResults.values())
					.sort((a, b) => b.score - a.score)
					.slice(0, 5)
					.map(r => ({
						pageId: r.page.id,
						title: r.page.title,
						url: r.page.url,
						reason: r.reason,
					}));

				let summary = `Documentation for store "${storeName}"`;
				if (kindHint) summary += ` (${kindHint})`;
				summary += ":\n\n";

				for (const [i, doc] of relevantDocs.entries()) {
					summary += `${i + 1}. ${doc.title}\n`;
					summary += `   ${doc.reason}\n`;
					summary += `   [Read: ${URIS.docsPage(doc.pageId)}]\n\n`;
				}

				const output = {
					storeName,
					kind: kindHint,
					relevantDocs,
				};

				return {
					content: [
						{
							type: "text",
							text: summary,
						},
					],
					structuredContent: output,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to find docs for store.\n\nStore: ${storeName}\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}
