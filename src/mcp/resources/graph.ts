import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { buildStoreGraph } from "../../domain/graphBuilder.js";
import { getWorkspaceRootPaths, resolveWorkspaceRoot } from "../../config/settings.js";

export function registerGraphResource(server: McpServer): void {
	server.registerResource(
		"graph",
		"nanostores://graph",
		{
			title: "Nanostores project graph",
			description:
				"Graph view of Nanostores stores in the current project (files, stores, consumers, and relationships).",
		},
		async uri => {
			let summaryText = "";
			let jsonText = "";

			try {
				const roots = getWorkspaceRootPaths();
				if (!roots.length) {
					throw new Error(
						"No workspace roots configured. Set NANOSTORES_MCP_ROOTS or NANOSTORES_MCP_ROOT.",
					);
				}

				const rootFsPath = resolveWorkspaceRoot();

				const index = await scanProject(rootFsPath);
				const graph = buildStoreGraph(index);

				const fileNodes = graph.nodes.filter(n => n.type === "file");
				const storeNodes = graph.nodes.filter(n => n.type === "store");
				const consumerNodes = graph.nodes.filter(n => n.type === "consumer");

				// Считаем stores по типу
				const kindCounts = new Map<string, number>();
				for (const node of storeNodes) {
					const storeNode = node as Extract<typeof node, { type: "store" }>;
					const kind = storeNode.kind ?? "unknown";
					kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
				}

				// Считаем "горячесть" stores по количеству uses-ребер
				const usageCounts = new Map<string, number>();
				for (const edge of graph.edges) {
					if (edge.type !== "uses") continue;
					usageCounts.set(edge.to, (usageCounts.get(edge.to) ?? 0) + 1);
				}

				const lines: string[] = [];

				lines.push(`Root: ${graph.rootDir}`);
				lines.push(`Files with stores: ${fileNodes.length}`);
				lines.push(`Total stores: ${storeNodes.length}`);
				lines.push(`Consumers: ${consumerNodes.length}`);
				lines.push(`Total edges: ${graph.edges.length}`);

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
						const storeNode = node as Extract<typeof node, { type: "store" }>;
						lines.push(
							`- [${storeNode.kind}] ${storeNode.name ?? storeNode.label}  (file: ${storeNode.file})`,
						);
					}
					if (storeNodes.length > preview.length) {
						lines.push(`… and ${storeNodes.length - preview.length} more`);
					}
				}

				// Hottest stores по количеству consumers/uses
				const storesWithUsage = storeNodes
					.map(node => {
						const storeNode = node as Extract<typeof node, { type: "store" }>;
						const count = usageCounts.get(storeNode.id) ?? 0;
						return { store: storeNode, count };
					})
					.filter(entry => entry.count > 0)
					.sort((a, b) => b.count - a.count);

				if (storesWithUsage.length > 0) {
					lines.push("");
					lines.push("Hottest stores (by consumers):");
					const top = storesWithUsage.slice(0, 10);
					for (const { store, count } of top) {
						lines.push(
							`- ${store.name ?? store.label}  (file: ${store.file}) — ${count} consumer(s)`,
						);
					}
					if (storesWithUsage.length > top.length) {
						lines.push(`… and ${storesWithUsage.length - top.length} more with consumers`);
					}
				} else {
					lines.push("");
					lines.push("No consumer → store relations detected yet (no useStore(...) found).");
				}

				summaryText = lines.join("\n");
				jsonText = JSON.stringify(graph, null, 2);
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				summaryText = "Failed to build Nanostores project graph.\n\n" + `Error: ${msg}`;
				jsonText = JSON.stringify({ error: msg }, null, 2);
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
