import type { ProjectIndex, StoreKind, ConsumerKind, StoreRelation } from "./fsScanner.js";

export type GraphNodeType = "file" | "store" | "consumer";

export interface BaseNode {
	id: string;
	type: GraphNodeType;
	label: string;
}

export interface FileNode extends BaseNode {
	type: "file";
	path: string;
}

export interface StoreNode extends BaseNode {
	type: "store";
	file: string;
	kind: StoreKind;
	name?: string;
}

export interface ConsumerNode extends BaseNode {
	type: "consumer";
	file: string;
	kind: ConsumerKind;
	name?: string;
	line?: number;
}

export type GraphNode = FileNode | StoreNode | ConsumerNode;

export type RelationType = "declares" | "uses" | "depends_on";

export interface GraphEdge {
	from: string;
	to: string;
	type: RelationType;
	file?: string;
	line?: number;
}

export interface StoreGraph {
	rootDir: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export function buildStoreGraph(index: ProjectIndex): StoreGraph {
	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];

	const ensureFileNode = (relativePath: string): FileNode => {
		const id = `file:${relativePath}`;
		const existing = nodes.get(id);
		if (existing && existing.type === "file") {
			return existing;
		}

		const node: FileNode = {
			id,
			type: "file",
			label: relativePath,
			path: relativePath,
		};
		nodes.set(id, node);
		return node;
	};

	// --- Узлы store + file-узлы для них ---

	for (const store of index.stores) {
		ensureFileNode(store.file);

		const node: StoreNode = {
			id: store.id,
			type: "store",
			label: store.name ?? store.id,
			file: store.file,
			kind: store.kind,
			name: store.name,
		};

		nodes.set(node.id, node);
	}

	// --- Узлы consumer + file-узлы для них ---

	for (const consumer of index.consumers) {
		ensureFileNode(consumer.file);

		const node: ConsumerNode = {
			id: consumer.id,
			type: "consumer",
			label: consumer.name ?? consumer.file,
			file: consumer.file,
			kind: consumer.kind,
			name: consumer.name,
			line: consumer.line,
		};

		nodes.set(node.id, node);
	}

	// --- Рёбра из relations: только если обе стороны существуют ---

	const addEdgeFromRelation = (rel: StoreRelation) => {
		const fromNode = nodes.get(rel.from);
		const toNode = nodes.get(rel.to);
		if (!fromNode || !toNode) return;

		edges.push({
			from: rel.from,
			to: rel.to,
			type: rel.type,
			file: rel.file,
			line: rel.line,
		});
	};

	for (const rel of index.relations) {
		addEdgeFromRelation(rel);
	}

	return {
		rootDir: index.rootDir,
		nodes: Array.from(nodes.values()),
		edges,
	};
}
