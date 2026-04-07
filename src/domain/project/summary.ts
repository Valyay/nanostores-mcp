import path from "node:path";
import type { ProjectIndex, StoreMatch, SubscriberMatch, StoreKind } from "./types.js";
// SubscriberMatch is used in buildStoreImpact below

const PERSISTENT_KINDS = new Set<StoreKind>(["persistentAtom", "persistentMap"]);

export type GraphOutlineResponse = {
	rootDir: string;
	totals: {
		stores: number;
		filesWithStores: number;
		subscribers: number;
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
		subscribers: number;
		derivedDependents: number;
		/** Subscriber count broken down by kind (component/hook/effect/etc.). */
		subscribersByKind: Record<string, number>;
		/** Mutator count broken down by kind (action/component/etc.). */
		mutatorsByKind: Record<string, number>;
	}>;
	/** Top store pairs that co-occur (appear together) in the same subscriber.
	 * Sorted by co-occurrence count descending. Reveals stores that are
	 * logically coupled from the consumer's perspective. */
	coOccurringPairs: Array<{
		storeIdA: string;
		nameA: string;
		storeIdB: string;
		nameB: string;
		/** Number of subscribers that use both stores simultaneously. */
		count: number;
	}>;
	/** Stores with no detected subscribers or derived dependents in the static graph.
	 * Raw signals only — qualitative interpretation (dead code, lazy-loaded, template-consumed, etc.)
	 * is left to the LLM consumer. Only populated when the project has subscriber/derived edges
	 * (i.e. when graph analysis is meaningful). */
	unreferencedStores: Array<{
		storeId: string;
		name: string;
		kind?: string;
		file?: string;
		valueType?: string;
		/** Number of mutators (set/setKey calls) targeting this store. > 0 suggests write-only pattern. */
		mutatorCount: number;
		/** Number of distinct SFC (.vue/.svelte) files that reference this store. > 0 suggests template consumption. */
		sfcFileReferences: number;
		/** Whether the store uses a persistent kind (persistentAtom/persistentMap). */
		isPersistent: boolean;
		/** Mutator count broken down by kind (action/component/etc.). */
		mutatorsByKind: Record<string, number>;
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
		valueType?: string;
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
	warning?: string;
};

const outlineCache = new WeakMap<ProjectIndex, GraphOutlineResponse>();

const TOP_DIRS_LIMIT = 10;
const HUBS_LIMIT = 10;
const PAIRS_LIMIT = 10;
const SFC_EXTENSIONS = new Set([".vue", ".svelte"]);

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
	const storeById = new Map(index.stores.map(store => [store.id, store]));
	const degree = new Map<string, number>();
	const subscribersCount = new Map<string, number>();
	const derivedCount = new Map<string, number>();
	const mutatorsCount = new Map<string, number>();

	// Track distinct SFC files that reference each store (via any relation)
	const sfcStoreRefs = new Map<string, Set<string>>();

	// Kind breakdowns — built from entity arrays for accurate kind metadata
	const subscribersByKind = new Map<string, Record<string, number>>();
	const mutatorsByKind = new Map<string, Record<string, number>>();

	if (hasRichEdges) {
		for (const rel of index.relations) {
			if (storeIds.has(rel.from)) {
				degree.set(rel.from, (degree.get(rel.from) ?? 0) + 1);
			}
			if (storeIds.has(rel.to)) {
				degree.set(rel.to, (degree.get(rel.to) ?? 0) + 1);
			}
			if (rel.type === "subscribes_to" && storeIds.has(rel.to)) {
				subscribersCount.set(rel.to, (subscribersCount.get(rel.to) ?? 0) + 1);
			}
			if (rel.type === "derives_from" && storeIds.has(rel.to)) {
				derivedCount.set(rel.to, (derivedCount.get(rel.to) ?? 0) + 1);
			}
			if (rel.type === "mutates" && storeIds.has(rel.to)) {
				mutatorsCount.set(rel.to, (mutatorsCount.get(rel.to) ?? 0) + 1);
			}
			// Track distinct SFC files that reference each store
			if (rel.file && SFC_EXTENSIONS.has(path.extname(rel.file).toLowerCase()) && storeIds.has(rel.to)) {
				let files = sfcStoreRefs.get(rel.to);
				if (!files) {
					files = new Set();
					sfcStoreRefs.set(rel.to, files);
				}
				files.add(rel.file);
			}
		}

		for (const sub of index.subscribers) {
			for (const storeId of sub.storeIds) {
				if (!storeIds.has(storeId)) continue;
				let breakdown = subscribersByKind.get(storeId);
				if (!breakdown) {
					breakdown = {};
					subscribersByKind.set(storeId, breakdown);
				}
				breakdown[sub.kind] = (breakdown[sub.kind] ?? 0) + 1;
			}
		}

		for (const mut of index.mutators) {
			for (const storeId of mut.storeIds) {
				if (!storeIds.has(storeId)) continue;
				let breakdown = mutatorsByKind.get(storeId);
				if (!breakdown) {
					breakdown = {};
					mutatorsByKind.set(storeId, breakdown);
				}
				breakdown[mut.kind] = (breakdown[mut.kind] ?? 0) + 1;
			}
		}
	}

	// Co-occurrence: count how often each pair of stores appears in the same subscriber
	const pairCounts = new Map<string, number>();
	const pairMeta = new Map<string, { storeIdA: string; nameA: string; storeIdB: string; nameB: string }>();
	for (const sub of index.subscribers) {
		const knownIds = sub.storeIds.filter(id => storeIds.has(id));
		if (knownIds.length < 2) continue;
		const sorted = [...knownIds].sort();
		for (let i = 0; i < sorted.length; i++) {
			for (let j = i + 1; j < sorted.length; j++) {
				const key = `${sorted[i]}||${sorted[j]}`;
				pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
				if (!pairMeta.has(key)) {
					const sa = storeById.get(sorted[i]);
					const sb = storeById.get(sorted[j]);
					if (sa && sb) {
						pairMeta.set(key, {
							storeIdA: sa.id,
							nameA: sa.name ?? sa.id,
							storeIdB: sb.id,
							nameB: sb.name ?? sb.id,
						});
					}
				}
			}
		}
	}
	const coOccurringPairs = Array.from(pairCounts.entries())
		.filter(([key]) => pairMeta.has(key))
		.map(([key, count]) => ({ ...pairMeta.get(key)!, count }))
		.sort((a, b) => b.count - a.count || a.nameA.localeCompare(b.nameA))
		.slice(0, PAIRS_LIMIT);

	const hubs = hasRichEdges
		? index.stores
				.map(store => ({
					storeId: store.id,
					name: store.name ?? store.id,
					kind: store.kind,
					file: store.file,
					score: degree.get(store.id) ?? 0,
					subscribers: subscribersCount.get(store.id) ?? 0,
					derivedDependents: derivedCount.get(store.id) ?? 0,
					subscribersByKind: subscribersByKind.get(store.id) ?? {},
					mutatorsByKind: mutatorsByKind.get(store.id) ?? {},
				}))
				.filter(hub => hub.score > 0)
				.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
				.slice(0, HUBS_LIMIT)
		: [];

	const unreferencedStores = hasRichEdges
		? index.stores
				.filter(
					store =>
						(subscribersCount.get(store.id) ?? 0) + (derivedCount.get(store.id) ?? 0) === 0,
				)
				.map(store => ({
					storeId: store.id,
					name: store.name ?? store.id,
					kind: store.kind,
					file: store.file,
					...(store.valueType !== undefined ? { valueType: store.valueType } : {}),
					mutatorCount: mutatorsCount.get(store.id) ?? 0,
					sfcFileReferences: sfcStoreRefs.get(store.id)?.size ?? 0,
					isPersistent: PERSISTENT_KINDS.has(store.kind),
					mutatorsByKind: mutatorsByKind.get(store.id) ?? {},
				}))
		: [];

	const outline: GraphOutlineResponse = {
		rootDir: index.rootDir,
		totals: {
			stores: index.stores.length,
			filesWithStores: filesWithStores.size,
			subscribers: index.subscribers.length,
		},
		storeKinds,
		topDirs,
		hubs,
		unreferencedStores,
		coOccurringPairs,
	};

	outlineCache.set(index, outline);
	return outline;
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
				...(store.valueType !== undefined ? { valueType: store.valueType } : {}),
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
		(a, b) =>
			a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type),
	);

	const summary = {
		nodes: nodes.length,
		edges: filteredEdges.length,
		subscribers: filteredEdges.filter(edge => edge.type === "subscribes_to").length,
		dependencies: filteredEdges.filter(edge => edge.type === "derives_from").length,
	};

	const storeNodes = nodes.filter(n => n.type === "store").length;
	const totalProjectStores = index.stores.length;
	const coverageRatio = totalProjectStores > 0 ? storeNodes / totalProjectStores : 0;
	const warning =
		coverageRatio > 0.8 && totalProjectStores > 10
			? `Subgraph covers ${Math.round(coverageRatio * 100)}% of project stores (${storeNodes}/${totalProjectStores}). Consider radius=1 for targeted analysis.`
			: undefined;

	return {
		centerStoreId: centerStore.id,
		radius: normalizedRadius,
		nodes,
		edges: filteredEdges,
		summary,
		...(warning !== undefined ? { warning } : {}),
	};
}

// ── buildStoreImpact ──────────────────────────────────────────────────────────

export type ImpactedStore = {
	id: string;
	name?: string;
	kind: string;
	file: string;
	valueType?: string;
};

export type ImpactedSubscriber = {
	id: string;
	name?: string;
	kind: string;
	file: string;
};

export type StoreImpactHop = {
	hop: number;
	derivedStores: ImpactedStore[];
	subscribers: ImpactedSubscriber[];
};

export type StoreImpactResponse = {
	sourceStoreId: string;
	sourceName?: string;
	hops: StoreImpactHop[];
	summary: {
		totalAffectedStores: number;
		totalAffectedSubscribers: number;
		maxHops: number;
	};
};

/**
 * Computes the downstream causal impact of a store change.
 *
 * Unidirectional BFS: follows derives_from edges downward (who declared X as
 * their dependency?) and collects subscribers at each hop. Stores are the
 * frontier; subscribers are terminal — they react but do not propagate.
 */
export function buildStoreImpact(
	index: ProjectIndex,
	sourceStore: StoreMatch,
): StoreImpactResponse {
	// Build O(1) lookup for store by id
	const storeById = new Map(index.stores.map(s => [s.id, s]));

	// Index: storeId → stores that derive FROM it
	const derivedBySource = new Map<string, StoreMatch[]>();
	for (const rel of index.relations) {
		if (rel.type !== "derives_from") continue;
		const dep = storeById.get(rel.from);
		if (!dep) continue;
		let list = derivedBySource.get(rel.to);
		if (!list) {
			list = [];
			derivedBySource.set(rel.to, list);
		}
		list.push(dep);
	}

	// Index: storeId → subscribers
	const subscribersByStore = new Map<string, SubscriberMatch[]>();
	for (const sub of index.subscribers) {
		for (const storeId of sub.storeIds) {
			let list = subscribersByStore.get(storeId);
			if (!list) {
				list = [];
				subscribersByStore.set(storeId, list);
			}
			list.push(sub);
		}
	}

	const hops: StoreImpactHop[] = [];
	const visitedStores = new Set<string>([sourceStore.id]);
	const visitedSubscribers = new Set<string>();

	// BFS: frontier is the set of stores being expanded at the current level
	let frontier: StoreMatch[] = [sourceStore];

	while (frontier.length > 0) {
		const nextFrontier: StoreMatch[] = [];
		const hopDerivedStores: ImpactedStore[] = [];
		const hopSubscribers: ImpactedSubscriber[] = [];

		// First pass: discover derived stores from the current frontier
		for (const store of frontier) {
			for (const derived of derivedBySource.get(store.id) ?? []) {
				if (visitedStores.has(derived.id)) continue;
				visitedStores.add(derived.id);
				hopDerivedStores.push({
					id: derived.id,
					name: derived.name,
					kind: derived.kind,
					file: derived.file,
					...(derived.valueType !== undefined ? { valueType: derived.valueType } : {}),
				});
				nextFrontier.push(derived);
			}
		}

		// Second pass: collect subscribers of frontier stores AND newly discovered
		// derived stores. Subscribers of a store appear at the same hop as the store
		// itself (subscribers of the source appear alongside its direct dependents).
		for (const store of [...frontier, ...nextFrontier]) {
			for (const sub of subscribersByStore.get(store.id) ?? []) {
				if (visitedSubscribers.has(sub.id)) continue;
				visitedSubscribers.add(sub.id);
				hopSubscribers.push({
					id: sub.id,
					name: sub.name,
					kind: sub.kind,
					file: sub.file,
				});
			}
		}

		// Only emit a hop if something was found
		if (hopDerivedStores.length > 0 || hopSubscribers.length > 0) {
			hops.push({
				hop: hops.length + 1,
				derivedStores: hopDerivedStores,
				subscribers: hopSubscribers,
			});
		}

		frontier = nextFrontier;
	}

	const totalAffectedStores = hops.reduce((n, h) => n + h.derivedStores.length, 0);
	const totalAffectedSubscribers = hops.reduce((n, h) => n + h.subscribers.length, 0);

	return {
		sourceStoreId: sourceStore.id,
		sourceName: sourceStore.name,
		hops,
		summary: {
			totalAffectedStores,
			totalAffectedSubscribers,
			maxHops: hops.length,
		},
	};
}
