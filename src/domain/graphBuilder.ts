import type { ScanResult, StoreKind, StoreMatch } from "./fsScanner.js";

export type GraphNodeType = "file" | "store";

export interface GraphNodeBase {
	id: string;
	type: GraphNodeType;
	label: string;
}

export interface FileNode extends GraphNodeBase {
	type: "file";
	path: string; // relative file path
}

export interface StoreNode extends GraphNodeBase {
	type: "store";
	file: string; // relative file path
	kind: StoreKind;
	name?: string;
}

export type GraphNode = FileNode | StoreNode;

export interface GraphEdge {
	from: string;
	to: string;
	type: "declares"; // in the future: "depends-on", etc.
}

export interface StoreGraph {
	rootDir: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

/**
 * Builds a simple graph: file → store (declares).
 */
export function buildStoreGraph(scan: ScanResult): StoreGraph {
	const fileNodeByPath = new Map<string, FileNode>();
	const storeNodes: StoreNode[] = [];
	const edges: GraphEdge[] = [];

	const ensureFileNode = (filePath: string): FileNode => {
		const existing = fileNodeByPath.get(filePath);
		if (existing) return existing;

		const node: FileNode = {
			id: `file:${filePath}`,
			type: "file",
			label: filePath,
			path: filePath,
		};
		fileNodeByPath.set(filePath, node);
		return node;
	};

	const createStoreNode = (store: StoreMatch): StoreNode => {
		const label = store.name ?? store.id;
		const node: StoreNode = {
			id: `store:${store.id}`,
			type: "store",
			label,
			file: store.file,
			kind: store.kind,
			name: store.name,
		};
		return node;
	};

	for (const store of scan.stores) {
		const fileNode = ensureFileNode(store.file);
		const storeNode = createStoreNode(store);
		storeNodes.push(storeNode);

		edges.push({
			from: fileNode.id,
			to: storeNode.id,
			type: "declares",
		});
	}

	const nodes: GraphNode[] = [...fileNodeByPath.values(), ...storeNodes];

	return {
		rootDir: scan.rootDir,
		nodes,
		edges,
	};
}
