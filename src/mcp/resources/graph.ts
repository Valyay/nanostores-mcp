import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { buildStoreGraph } from "../../domain/graphBuilder.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import type { StoreGraph, StoreNode, SubscriberNode } from "../../domain/graphBuilder.js";

function buildGraphSummary(graph: StoreGraph): string {
	const lines: string[] = [];

	lines.push(`Root: ${graph.rootDir}`);
	lines.push(`Files with stores: ${graph.stats.filesWithStores}`);
	lines.push(`Stores: ${graph.stats.totalStores}`);
	lines.push(`Subscribers (components/hooks/effects): ${graph.stats.subscribers}`);
	lines.push(
		`Relations: declares=${graph.stats.edgesByType.declares}, ` +
			`subscribes_to=${graph.stats.edgesByType.subscribes_to}, ` +
			`derives_from=${graph.stats.edgesByType.derives_from}`,
	);

	if (graph.hotStores.length > 0) {
		lines.push("");
		lines.push("Hot stores (by subscribers + derived dependents):");

		for (const hot of graph.hotStores.slice(0, 10)) {
			lines.push(
				`- ${hot.name} (${hot.file}) — subscribers=${hot.subscribers}, derivedDependents=${hot.derivedDependents}, total=${hot.totalDegree}`,
			);
		}
	}

	// небольшой предпросмотр узлов
	const storeNodes = graph.nodes.filter(n => n.type === "store").slice(0, 5);
	const subscriberNodes = graph.nodes.filter(n => n.type === "subscriber").slice(0, 5);

	if (storeNodes.length > 0) {
		lines.push("");
		lines.push("Example stores:");
		for (const node of storeNodes) {
			const store = node as StoreNode;
			lines.push(`- [${store.kind}] ${store.name ?? store.label} (file: ${store.file})`);
		}
	}

	if (subscriberNodes.length > 0) {
		lines.push("");
		lines.push("Example subscribers:");
		for (const node of subscriberNodes) {
			const sub = node as SubscriberNode;
			lines.push(`- [${sub.kind}] ${sub.name ?? sub.label} (file: ${sub.file})`);
		}
	}

	return lines.join("\n");
}

export function registerGraphResource(server: McpServer): void {
	server.registerResource(
		"graph",
		"nanostores://graph",
		{
			title: "Nanostores project graph",
			description:
				"Graph of Nanostores stores and subscribers (components/hooks/effects) in the current workspace.",
		},
		async uri => {
			try {
				const rootPath = resolveWorkspaceRoot();
				const index = await scanProject(rootPath);
				const graph = buildStoreGraph(index);

				const summary = buildGraphSummary(graph);
				const json = JSON.stringify(graph, null, 2);

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: summary,
						},
						{
							uri: `${uri.href}#json`,
							mimeType: "application/json",
							text: json,
						},
					],
					structuredContent: graph,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to build Nanostores graph.\n\n" + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}
