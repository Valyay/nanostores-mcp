import type {
	ProjectIndex,
	StoreKind,
	SubscriberKind,
	StoreRelation,
	GraphEdgeType,
} from "./fsScanner/index.js";

export type GraphNodeType = "file" | "store" | "subscriber";

interface BaseNode {
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

export interface SubscriberNode extends BaseNode {
	type: "subscriber";
	file: string;
	kind: SubscriberKind;
	name?: string;
}

export type GraphNode = FileNode | StoreNode | SubscriberNode;

export type GraphEdge = StoreRelation;

export interface HotStore {
	storeId: string;
	name: string;
	file: string;
	subscribers: number;
	derivedDependents: number;
	totalDegree: number;
}

export interface StoreGraph {
	rootDir: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
	stats: {
		filesWithStores: number;
		totalStores: number;
		subscribers: number;
		edgesByType: Record<GraphEdgeType, number>;
	};
	hotStores: HotStore[];
}

/**
 * Convert ProjectIndex to graph:
 * - file / store / subscriber nodes
 * - edges from relations
 * - basic stats and "hot" stores
 */
export function buildStoreGraph(index: ProjectIndex): StoreGraph {
	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];

	const filesWithStores = new Set<string>();

	for (const store of index.stores) {
		filesWithStores.add(store.file);

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

	for (const subscriber of index.subscribers) {
		filesWithStores.add(subscriber.file);

		const node: SubscriberNode = {
			id: subscriber.id,
			type: "subscriber",
			label: subscriber.name ?? subscriber.id,
			file: subscriber.file,
			kind: subscriber.kind,
			name: subscriber.name,
		};
		nodes.set(node.id, node);
	}

	for (const file of filesWithStores) {
		const id = `file:${file}`;
		if (!nodes.has(id)) {
			const node: FileNode = {
				id,
				type: "file",
				label: file,
				path: file,
			};
			nodes.set(node.id, node);
		}
	}

	const edgeCounts: Record<GraphEdgeType, number> = {
		declares: 0,
		subscribes_to: 0,
		derives_from: 0,
	};

	for (const rel of index.relations) {
		edges.push({
			from: rel.from,
			to: rel.to,
			type: rel.type,
			file: rel.file,
			line: rel.line,
		});
		edgeCounts[rel.type] = (edgeCounts[rel.type] ?? 0) + 1;
	}

	// calculate "hot" stores by subscriber count and derived dependencies
	const storeIds = new Set(index.stores.map(s => s.id));
	const subscribersCount = new Map<string, number>();
	const derivedCount = new Map<string, number>();

	for (const edge of edges) {
		if (edge.type === "subscribes_to" && storeIds.has(edge.to)) {
			subscribersCount.set(edge.to, (subscribersCount.get(edge.to) ?? 0) + 1);
		}
		if (edge.type === "derives_from" && storeIds.has(edge.to)) {
			derivedCount.set(edge.to, (derivedCount.get(edge.to) ?? 0) + 1);
		}
	}

	const hotStores: HotStore[] = index.stores
		.map(store => {
			const subs = subscribersCount.get(store.id) ?? 0;
			const deps = derivedCount.get(store.id) ?? 0;
			return {
				storeId: store.id,
				name: store.name ?? store.id,
				file: store.file,
				subscribers: subs,
				derivedDependents: deps,
				totalDegree: subs + deps,
			};
		})
		.filter(s => s.totalDegree > 0)
		.sort((a, b) => b.totalDegree - a.totalDegree)
		.slice(0, 10);

	return {
		rootDir: index.rootDir,
		nodes: Array.from(nodes.values()),
		edges,
		stats: {
			filesWithStores: filesWithStores.size,
			totalStores: index.stores.length,
			subscribers: index.subscribers.length,
			edgesByType: edgeCounts,
		},
		hotStores,
	};
}
