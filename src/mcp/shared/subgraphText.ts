import type { StoreSubgraphResponse } from "../../domain/project/summary.js";

type SubgraphNode = StoreSubgraphResponse["nodes"][number];
type SubgraphEdge = StoreSubgraphResponse["edges"][number];

function nodeDisplayName(node: SubgraphNode): string {
	return node.type === "store" ? (node.name ?? node.id) : (node.path ?? node.id);
}

function shortPath(fullPath: string): string {
	return fullPath.split("/").slice(-2).join("/");
}

/**
 * Builds a human-readable text summary of a store subgraph for LLM consumption.
 * Shows store nodes with their kinds and relationships, and subscriber files,
 * instead of just opaque counts.
 */
export function formatSubgraphText(
	subgraph: StoreSubgraphResponse,
	centerName: string,
): string {
	const { centerStoreId, radius, nodes, edges } = subgraph;

	// ── index edges by source for fast lookup ──────────────────────────────────
	const edgesFrom = new Map<string, SubgraphEdge[]>();
	for (const edge of edges) {
		let list = edgesFrom.get(edge.from);
		if (!list) {
			list = [];
			edgesFrom.set(edge.from, list);
		}
		list.push(edge);
	}

	// ── build node id → node lookup ────────────────────────────────────────────
	const nodeById = new Map<string, SubgraphNode>(nodes.map(n => [n.id, n]));

	// ── separate stores from files ─────────────────────────────────────────────
	const storeNodes = nodes.filter(n => n.type === "store");
	const fileNodes = nodes.filter(n => n.type === "file");

	// ── subscriber files: files that have at least one subscribes_to edge ─────
	const subscriberFiles = fileNodes.filter(f =>
		(edgesFrom.get(f.id) ?? []).some(e => e.type === "subscribes_to"),
	);

	// ── format header ──────────────────────────────────────────────────────────
	let out = `Subgraph for ${centerName} (radius=${radius})`;

	// ── stores section ─────────────────────────────────────────────────────────
	if (storeNodes.length > 0) {
		out += `\n\nStores (${storeNodes.length}):`;
		for (const node of storeNodes) {
			const kind = node.kind ?? "store";
			const name = nodeDisplayName(node);
			const typeAnnotation = node.valueType ? `: ${node.valueType}` : "";
			let line = `\n  [${kind}] ${name}${typeAnnotation}`;

			if (node.id === centerStoreId) {
				line += " ← center";
			} else {
				// Show derives_from source if this store derives from another in the subgraph
				const derivesEdges = (edgesFrom.get(node.id) ?? []).filter(
					e => e.type === "derives_from",
				);
				if (derivesEdges.length > 0) {
					const sources = derivesEdges
						.map(e => nodeById.get(e.to))
						.filter(Boolean)
						.map(n => nodeDisplayName(n!));
					if (sources.length > 0) {
						line += ` ← derives from ${sources.join(", ")}`;
					}
				}
			}

			out += line;
		}
	}

	// ── subscribers section ────────────────────────────────────────────────────
	if (subscriberFiles.length > 0) {
		out += `\n\nSubscribers (${subscriberFiles.length} file${subscriberFiles.length === 1 ? "" : "s"}):`;
		for (const file of subscriberFiles) {
			const subEdges = (edgesFrom.get(file.id) ?? []).filter(
				e => e.type === "subscribes_to",
			);
			const storeNames = subEdges
				.map(e => nodeById.get(e.to))
				.filter(Boolean)
				.map(n => nodeDisplayName(n!));
			const filePath = file.path ?? file.id;
			out += `\n  ${shortPath(filePath)} → ${storeNames.join(", ")}`;
		}
	}

	// ── warning ────────────────────────────────────────────────────────────────
	if (subgraph.warning) {
		out += `\n\nWarning: ${subgraph.warning}`;
	}

	return out;
}
