import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DocsRepository } from "../../domain/docsIndex.js";
import type { DocPage } from "../../domain/docsTypes.js";
import { DOCS_DISABLED_MESSAGE } from "../shared/consts.js";
import { URIS } from "../uris.js";

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
export function registerDocsSearchTool(
	server: McpServer,
	docsRepository: DocsRepository | null,
): void {
	server.registerTool(
		"nanostores_docs_search",
		{
			title: "Search Nanostores documentation",
			description:
				"Search through Nanostores documentation for relevant information. Returns snippets and page references.",
			inputSchema: DocsSearchInputSchema,
			outputSchema: DocsSearchOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ query, limit, tags }) => {
			if (!docsRepository) {
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

			const result = await docsRepository.search(query, { limit, tags });

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
				summary += `   [Read more: nanostores://docs/page/${res.pageId}]\n\n`;
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
export function registerDocsForStoreTool(
	server: McpServer,
	docsRepository: DocsRepository | null,
): void {
	server.registerTool(
		"nanostores_docs_for_store",
		{
			title: "Find docs for store",
			description:
				"Find relevant Nanostores documentation for a specific store based on its type and usage patterns.",
			inputSchema: DocsForStoreInputSchema,
			outputSchema: DocsForStoreOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ storeName, kindHint }) => {
			if (!docsRepository) {
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
				const result = await docsRepository.search(query, { limit: 3 });

				for (const hit of result.hits) {
					const existing = allResults.get(hit.page.id);
					if (!existing || existing.score < hit.score) {
						allResults.set(hit.page.id, {
							page: hit.page,
							score: hit.score,
							reason: `Relevant for ${kindHint || "store"} type`,
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
		},
	);
}
