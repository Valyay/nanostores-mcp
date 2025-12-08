import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsService } from "../../domain/index.js";
import { DOCS_DISABLED_MESSAGE } from "../shared/consts.js";
import { URIS } from "../uris.js";

/**
 * Register nanostores://docs - documentation index
 */
export function registerDocsIndexResource(
	server: McpServer,
	docsService: DocsService | null,
): void {
	server.registerResource(
		"docs-index",
		new ResourceTemplate(URIS.docsIndex, {
			list: undefined,
		}),
		{
			title: "Nanostores documentation index",
			description:
				"Index of Nanostores documentation pages and chunks. Lists all available topics and tags.",
		},
		async uri => {
			if (!docsService) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: DOCS_DISABLED_MESSAGE,
						},
					],
				};
			}

			const index = await docsService.getIndex();

			// Group pages by tags
			const tagCounts = new Map<string, number>();
			for (const page of index.pages) {
				for (const tag of page.tags) {
					tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
				}
			}

			const tagsList = Array.from(tagCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([tag, count]) => `- ${tag}: ${count} pages`)
				.join("\n");

			const summary = `Nanostores Documentation Index

Pages: ${index.pages.length}
Chunks: ${index.chunks.length}
Last built: ${new Date(index.builtAt).toISOString()}

Tags:
${tagsList}

Top pages:
${index.pages
	.slice(0, 10)
	.map(p => `- ${p.title} (${p.id})`)
	.join("\n")}
`;

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: summary,
					},
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(index, null, 2),
					},
				],
			};
		},
	);
}

/**
 * Register nanostores://docs/page/{id} - specific documentation page
 */
export function registerDocsPageResource(server: McpServer, docsService: DocsService | null): void {
	server.registerResource(
		"docs-page",
		new ResourceTemplate(URIS.docsPageTemplate, {
			list: undefined,
		}),
		{
			title: "Nanostores documentation page",
			description: "Full content of a specific documentation page with metadata and chunks.",
		},
		async (uri, { id }) => {
			if (!docsService) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: DOCS_DISABLED_MESSAGE,
						},
					],
				};
			}

			const pageId = id as string;
			const page = await docsService.getPage(pageId);

			if (!page) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: `Page not found: ${pageId}\n\nUse nanostores://docs to see available pages.`,
						},
					],
				};
			}

			const chunks = await docsService.getPageChunks(pageId);

			// Read full file content
			const fullText = chunks.map(c => c.text).join("\n\n");

			const summary = `# ${page.title}

Tags: ${page.tags.join(", ")}
${page.url ? `URL: ${page.url}` : ""}
File: ${page.filePath}

${page.summary || ""}

---

${fullText}
`;

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/markdown",
						text: summary,
					},
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify({ page, chunks }, null, 2),
					},
				],
			};
		},
	);
}

/**
 * Register nanostores://docs/search - search documentation
 */
export function registerDocsSearchResource(
	server: McpServer,
	docsService: DocsService | null,
): void {
	server.registerResource(
		"docs-search",
		new ResourceTemplate(URIS.docsSearch, {
			list: undefined,
		}),
		{
			title: "Search Nanostores documentation",
			description: "Search documentation by query. Query params: ?q=query&tag=tag&limit=10",
		},
		async uri => {
			if (!docsService) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: DOCS_DISABLED_MESSAGE,
						},
					],
				};
			}

			const url = new URL(uri.href);
			const query = url.searchParams.get("q") || "";
			const tag = url.searchParams.get("tag");
			const limit = Number.parseInt(url.searchParams.get("limit") || "10", 10);

			if (!query) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "No query provided. Use ?q=your+search+query",
						},
					],
				};
			}

			const result = await docsService.search(query, {
				limit,
				tags: tag ? [tag] : undefined,
			});

			let summary = `Search: "${query}"\n`;
			if (tag) summary += `Tag filter: ${tag}\n`;
			summary += `\nResults: ${result.hits.length}\n\n`;

			for (let i = 0; i < result.hits.length; i++) {
				const hit = result.hits[i];
				const snippet = hit.chunk.text.slice(0, 150).replace(/\n/g, " ");
				const headingPath = hit.chunk.headingPath.join(" > ");

				summary += `${i + 1}. ${hit.page.title}`;
				if (headingPath) summary += ` > ${headingPath}`;
				summary += `\n   Score: ${hit.score.toFixed(2)}\n`;
				summary += `   "${snippet}..."\n`;
				summary += `   Page: ${hit.page.id}\n\n`;
			}

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: summary,
					},
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(result, null, 2),
					},
				],
			};
		},
	);
}
