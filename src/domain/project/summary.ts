import path from "node:path";
import type { ProjectIndex, StoreMatch } from "./types.js";

export type GraphOutlineResponse = {
	rootDir: string;
	totals: {
		stores: number;
		filesWithStores: number;
	};
	storeKinds: Record<string, number>;
	topDirs: Array<{
		dir: string;
		stores: number;
		files: number;
	}>;
	hubs: Array<{
		storeId: string;
		name: string;
		kind?: string;
		file?: string;
		score: number;
	}>;
};

export type IdDictionaryResponse = {
	version: 1;
	generatedAt: string;
	stores: Array<{
		sid: number;
		fullId: string;
		name: string;
		file?: string;
		kind?: string;
	}>;
	files: Array<{
		fid: number;
		path: string;
		fullId?: string;
	}>;
};

export type StoreSubgraphResponse = {
	centerStoreId: string;
	radius: number;
	nodes: Array<{
		id: string;
		type: "store" | "file";
		name?: string;
		kind?: string;
		file?: string;
		path?: string;
	}>;
	edges: Array<{
		from: string;
		to: string;
		type: string;
	}>;
	summary?: {
		nodes: number;
		edges: number;
		subscribers?: number;
		dependencies?: number;
	};
};

const outlineCache = new WeakMap<ProjectIndex, GraphOutlineResponse>();
const dictionaryCache = new WeakMap<ProjectIndex, IdDictionaryResponse>();

const TOP_DIRS_LIMIT = 10;
const HUBS_LIMIT = 10;

export function buildGraphOutline(index: ProjectIndex): GraphOutlineResponse {
	const cached = outlineCache.get(index);
	if (cached) {
		return cached;
	}

	const storeKinds: Record<string, number> = {};
	const filesWithStores = new Set<string>();
	const dirStats = new Map<string, { stores: number; files: Set<string> }>();

	for (const store of index.stores) {
		storeKinds[store.kind] = (storeKinds[store.kind] ?? 0) + 1;
		filesWithStores.add(store.file);

		const rawDir = path.dirname(store.file);
		const dir = rawDir === "." ? "." : rawDir;
		let entry = dirStats.get(dir);
		if (!entry) {
			entry = { stores: 0, files: new Set() };
			dirStats.set(dir, entry);
		}
		entry.stores += 1;
		entry.files.add(store.file);
	}

	const topDirs = Array.from(dirStats.entries())
		.map(([dir, entry]) => ({
			dir,
			stores: entry.stores,
			files: entry.files.size,
		}))
		.sort((a, b) => b.stores - a.stores || b.files - a.files || a.dir.localeCompare(b.dir))
		.slice(0, TOP_DIRS_LIMIT);

	const hasRichEdges = index.relations.some(rel => rel.type !== "declares");
	const storeIds = new Set(index.stores.map(store => store.id));
	const degree = new Map<string, number>();

	if (hasRichEdges) {
		for (const rel of index.relations) {
			if (storeIds.has(rel.from)) {
				degree.set(rel.from, (degree.get(rel.from) ?? 0) + 1);
			}
			if (storeIds.has(rel.to)) {
				degree.set(rel.to, (degree.get(rel.to) ?? 0) + 1);
			}
		}
	}

	const hubs = hasRichEdges
		? index.stores
				.map(store => ({
					storeId: store.id,
					name: store.name ?? store.id,
					kind: store.kind,
					file: store.file,
					score: degree.get(store.id) ?? 0,
				}))
				.filter(hub => hub.score > 0)
				.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
				.slice(0, HUBS_LIMIT)
		: [];

	const outline: GraphOutlineResponse = {
		rootDir: index.rootDir,
		totals: {
			stores: index.stores.length,
			filesWithStores: filesWithStores.size,
		},
		storeKinds,
		topDirs,
		hubs,
	};

	outlineCache.set(index, outline);
	return outline;
}

export function buildIdDictionary(index: ProjectIndex): IdDictionaryResponse {
	const cached = dictionaryCache.get(index);
	if (cached) {
		return cached;
	}

	const storesSorted = [...index.stores].sort((a, b) => a.id.localeCompare(b.id));
	const stores = storesSorted.map((store, idx) => ({
		sid: idx + 1,
		fullId: store.id,
		name: store.name ?? store.id,
		file: store.file,
		kind: store.kind,
	}));

	const filePaths = new Set<string>();
	for (const store of index.stores) {
		filePaths.add(store.file);
	}
	for (const sub of index.subscribers) {
		filePaths.add(sub.file);
	}

	const filesSorted = Array.from(filePaths).sort();
	const files = filesSorted.map((filePath, idx) => ({
		fid: idx + 1,
		path: filePath,
		fullId: `file:${filePath}`,
	}));

	const dictionary: IdDictionaryResponse = {
		version: 1,
		generatedAt: new Date().toISOString(),
		stores,
		files,
	};

	dictionaryCache.set(index, dictionary);
	return dictionary;
}

export function buildStoreSubgraph(
	index: ProjectIndex,
	centerStore: StoreMatch,
	radius: number = 2,
): StoreSubgraphResponse {
	const normalizedRadius = Number.isFinite(radius) ? Math.max(0, Math.floor(radius)) : 2;

	const storeIds = new Set(index.stores.map(store => store.id));
	const storeById = new Map(index.stores.map(store => [store.id, store]));

	const edges: StoreSubgraphResponse["edges"] = [];
	const edgeKeys = new Set<string>();

	function addEdge(from: string, to: string, type: string): void {
		const key = `${type}:${from}->${to}`;
		if (edgeKeys.has(key)) {
			return;
		}
		edgeKeys.add(key);
		edges.push({ from, to, type });
	}

	for (const store of index.stores) {
		const fileId = `file:${store.file}`;
		addEdge(fileId, store.id, "declares");
	}

	for (const rel of index.relations) {
		if (rel.type !== "derives_from") continue;
		if (!storeIds.has(rel.from) || !storeIds.has(rel.to)) continue;
		addEdge(rel.from, rel.to, rel.type);
	}

	for (const sub of index.subscribers) {
		const from = `file:${sub.file}`;
		for (const storeId of sub.storeIds) {
			if (storeIds.has(storeId)) {
				addEdge(from, storeId, "subscribes_to");
			}
		}
	}

	const adjacency = new Map<string, Set<string>>();
	for (const edge of edges) {
		let fromSet = adjacency.get(edge.from);
		if (!fromSet) {
			fromSet = new Set();
			adjacency.set(edge.from, fromSet);
		}
		fromSet.add(edge.to);

		let toSet = adjacency.get(edge.to);
		if (!toSet) {
			toSet = new Set();
			adjacency.set(edge.to, toSet);
		}
		toSet.add(edge.from);
	}

	const included = new Set<string>();
	const distances = new Map<string, number>();
	const queue: Array<{ id: string; distance: number }> = [];

	included.add(centerStore.id);
	distances.set(centerStore.id, 0);
	queue.push({ id: centerStore.id, distance: 0 });

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		if (current.distance >= normalizedRadius) {
			continue;
		}
		const neighbors = adjacency.get(current.id);
		if (!neighbors) continue;
		for (const neighbor of neighbors) {
			if (distances.has(neighbor)) continue;
			const nextDistance = current.distance + 1;
			distances.set(neighbor, nextDistance);
			included.add(neighbor);
			queue.push({ id: neighbor, distance: nextDistance });
		}
	}

	const centerFileId = `file:${centerStore.file}`;
	included.add(centerFileId);

	const nodes: StoreSubgraphResponse["nodes"] = [];
	for (const nodeId of included) {
		if (nodeId.startsWith("store:")) {
			const store = storeById.get(nodeId);
			if (!store) continue;
			nodes.push({
				id: store.id,
				type: "store",
				name: store.name,
				kind: store.kind,
				file: store.file,
			});
		} else if (nodeId.startsWith("file:")) {
			nodes.push({
				id: nodeId,
				type: "file",
				path: nodeId.slice("file:".length),
			});
		}
	}

	const filteredEdges = edges.filter(edge => included.has(edge.from) && included.has(edge.to));

	nodes.sort((a, b) => a.id.localeCompare(b.id));
	filteredEdges.sort(
		(a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type),
	);

	const summary = {
		nodes: nodes.length,
		edges: filteredEdges.length,
		subscribers: filteredEdges.filter(edge => edge.type === "subscribes_to").length,
		dependencies: filteredEdges.filter(edge => edge.type === "derives_from").length,
	};

	return {
		centerStoreId: centerStore.id,
		radius: normalizedRadius,
		nodes,
		edges: filteredEdges,
		summary,
	};
}
