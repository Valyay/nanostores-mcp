import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectAnalysisService } from "../../domain/index.js";
import { URIS } from "../uris.js";
import {
	buildStoreGraph,
	type StoreGraph,
	type StoreNode,
	type SubscriberNode,
} from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

function sanitizeId(id: string): string {
	// Mermaid does not handle colons, slashes, etc. well
	return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Sanitizes label for use inside Mermaid node label.
 * Escapes or removes special characters that could break Mermaid parsing.
 */
function sanitizeLabel(label: string): string {
	// Replace quotes and brackets that could break Mermaid
	return label
		.replace(/"/g, "'") // double quotes → single quotes
		.replace(/\[/g, "(") // square brackets → parentheses
		.replace(/\]/g, ")")
		.replace(/</g, "‹") // angle brackets → typographic quotes
		.replace(/>/g, "›")
		.replace(/\{/g, "(") // curly brackets → parentheses
		.replace(/\}/g, ")")
		.replace(/\|/g, "¦") // pipe → broken bar
		.replace(/\n/g, " ") // line breaks → spaces
		.trim();
}

function kindLabelForSubscriber(kind: SubscriberNode["kind"]): string {
	switch (kind) {
		case "component":
			return "component";
		case "hook":
			return "hook";
		case "effect":
			return "effect";
		default:
			return "subscriber";
	}
}

function displayNameForSubscriber(sub: SubscriberNode): string {
	// If name is specified — use it
	if (sub.name && sub.name !== sub.id) return sub.name;
	// Otherwise take base filename (App from src/App.tsx)
	const base = path.basename(sub.file || "", path.extname(sub.file || ""));
	return base || sub.label;
}

function displayNameForStore(store: StoreNode): string {
	if (store.name && store.name !== store.id) return store.name;
	return store.label;
}

/**
 * Build mermaid diagram:
 * - group stores and subscribers by files via subgraph
 * - edges shown in data-flow style:
 *   - store -> subscriber (updates)
 *   - baseStore -> derivedStore (derives)
 */
export function buildMermaidFromGraph(graph: StoreGraph): string {
	const lines: string[] = [];

	lines.push("graph LR");

	// Group nodes by files, ignoring file-nodes (type 'file')
	const byFile = new Map<
		string,
		{
			stores: StoreNode[];
			subscribers: SubscriberNode[];
		}
	>();

	for (const node of graph.nodes) {
		if (node.type === "store") {
			const store = node as StoreNode;
			const file = store.file || "unknown";
			let bucket = byFile.get(file);
			if (!bucket) {
				bucket = { stores: [], subscribers: [] };
				byFile.set(file, bucket);
			}
			bucket.stores.push(store);
		} else if (node.type === "subscriber") {
			const sub = node as SubscriberNode;
			const file = sub.file || "unknown";
			let bucket = byFile.get(file);
			if (!bucket) {
				bucket = { stores: [], subscribers: [] };
				byFile.set(file, bucket);
			}
			bucket.subscribers.push(sub);
		}
	}

	// Map node id → mermaid-id to draw edges later
	const nodeIdMap = new Map<string, string>();

	// Draw subgraph for each file
	const sortedFiles = Array.from(byFile.keys()).sort((a, b) => a.localeCompare(b));

	for (const file of sortedFiles) {
		const bucket = byFile.get(file);
		if (!bucket) continue;

		const title = sanitizeLabel(file);

		lines.push(`subgraph "${title}"`);

		// stores
		for (const store of bucket.stores) {
			const mid = sanitizeId(store.id);
			nodeIdMap.set(store.id, mid);

			const display = sanitizeLabel(displayNameForStore(store));
			const kind = sanitizeLabel(store.kind ?? "store");

			lines.push(`${mid}["🧱 ${display} (${kind})"]`);
		}

		// subscribers
		for (const sub of bucket.subscribers) {
			const mid = sanitizeId(sub.id);
			nodeIdMap.set(sub.id, mid);

			const display = sanitizeLabel(displayNameForSubscriber(sub));
			const kindLabel = sanitizeLabel(kindLabelForSubscriber(sub.kind));

			lines.push(`${mid}["🧩 ${display} (${kindLabel})"]`);
		}

		lines.push("end");
	}

	// Draw edges.
	// Internal graph:
	//   - declares: file -> store (not drawn in Mermaid, file already visible as subgraph)
	//   - subscribes_to: subscriber -> store
	//   - derives_from: derived -> base
	//
	// For Mermaid expand to data-flow:
	//   - store --> subscriber (updates)
	//   - baseStore --> derivedStore (derives)
	for (const edge of graph.edges) {
		if (edge.type === "declares") {
			// skip, sufficient that nodes are grouped by files
			continue;
		}

		let fromId = edge.from;
		let toId = edge.to;
		let label = "";

		if (edge.type === "subscribes_to") {
			// in index: subscriber -> store (depends on)
			// in visualization: store -> subscriber (where change flows)
			[fromId, toId] = [edge.to, edge.from];
			label = "updates";
		} else if (edge.type === "derives_from") {
			// in index: derived -> base
			// in visualization: base -> derived
			[fromId, toId] = [edge.to, edge.from];
			label = "derives";
		} else {
			// just in case new types appear
			label = edge.type;
		}

		const fromMid = nodeIdMap.get(fromId);
		const toMid = nodeIdMap.get(toId);

		// If one endpoint is file-node (we didn't draw it), just skip
		if (!fromMid || !toMid) continue;

		if (label) {
			lines.push(`${fromMid} -->|${label}| ${toMid}`);
		} else {
			lines.push(`${fromMid} --> ${toMid}`);
		}
	}

	return lines.join("\n");
}

export function registerGraphMermaidResource(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerResource(
		"graph-mermaid",
		URIS.graphMermaid,
		{
			title: "Nanostores project graph (Mermaid)",
			description:
				"Graph representation of Nanostores stores and subscribers (components/hooks/effects) as a Mermaid diagram.",
		},
		async uri => {
			try {
				const rootPath = resolveWorkspaceRoot();
				const index = await projectService.getIndex(rootPath);
				const graph = buildStoreGraph(index);

				const mermaid = buildMermaidFromGraph(graph);
				const markdown = ["```mermaid", mermaid, "```"].join("\n");

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/markdown",
							text: markdown,
						},
						{
							uri: `${uri.href}#mermaid`,
							mimeType: "text/plain",
							text: mermaid,
						},
					],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to build Nanostores Mermaid graph.\n\n" + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}
