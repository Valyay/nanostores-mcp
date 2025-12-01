import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { buildStoreGraph } from "../../domain/graphBuilder.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

export function registerGraphResource(server: McpServer): void {
	server.registerResource(
		"graph",
		"nanostores://graph",
		{
			title: "Nanostores project graph",
			description:
				"Graph view of nanostores stores in the current project (files, stores, and declaration edges).",
			// mimeType здесь опционален, так как мы возвращаем несколько contents с разными mimeType
		},
		async uri => {
			let summaryText = "";
			let jsonText = "";

			try {
				const rootPath = resolveWorkspaceRoot();
				const scan = await scanProject(rootPath);
				const graph = buildStoreGraph(scan);

				const fileNodes = graph.nodes.filter(n => n.type === "file");
				const storeNodes = graph.nodes.filter(n => n.type === "store");

				const kindCounts = new Map<string, number>();
				for (const node of storeNodes) {
					const kind = node.kind ?? "unknown";
					kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
				}

				const lines: string[] = [];

				lines.push(`Root: ${graph.rootDir}`);
				lines.push(`Files with stores: ${fileNodes.length}`);
				lines.push(`Total stores: ${storeNodes.length}`);
				lines.push(`Graph edges (file → store declarations): ${graph.edges.length}`);

				if (kindCounts.size > 0) {
					lines.push("");
					lines.push("Stores by kind:");
					for (const [kind, count] of kindCounts.entries()) {
						lines.push(`- ${kind}: ${count}`);
					}
				}

				if (storeNodes.length > 0) {
					lines.push("");
					lines.push("First store nodes:");
					const preview = storeNodes.slice(0, 15);
					for (const node of preview) {
						lines.push(`- [${node.kind}] ${node.name ?? node.label}  (file: ${node.file})`);
					}
					if (storeNodes.length > preview.length) {
						lines.push(`… and ${storeNodes.length - preview.length} more`);
					}
				}

				summaryText = lines.join("\n");
				jsonText = JSON.stringify(graph, null, 2);
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				summaryText = "Failed to build nanostores project graph.\n\n" + `Error: ${msg}`;
				jsonText = JSON.stringify(
					{
						error: msg,
					},
					null,
					2,
				);
			}

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: summaryText,
					},
					{
						uri: `${uri.href}#json`,
						mimeType: "application/json",
						text: jsonText,
					},
				],
			};
		},
	);
}
