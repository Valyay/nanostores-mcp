import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocsService } from "../../domain/index.js";
import { DOCS_DISABLED_MESSAGE } from "../shared/consts.js";
import { aggregateTags } from "../shared/docsHelpers.js";
import { URIS } from "../uris.js";

/**
 * Register nanostores://docs - documentation index
 */
export function registerDocsIndexResource(
	server: McpServer,
	getDocsService: () => DocsService | null,
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
			const docsService = getDocsService();
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

			const tagsList = aggregateTags(index.pages)
				.map(({ tag, count }) => `- ${tag}: ${count} pages`)
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
export function registerDocsPageResource(server: McpServer, getDocsService: () => DocsService | null): void {
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
			const docsService = getDocsService();
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
							text: `Page not found: ${pageId}\n\nUse the nanostores://docs resource to see available pages, or check the page ID for typos.`,
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
