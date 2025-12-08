import {
	scanProject,
	type ProjectIndex,
	type StoreMatch,
	type SubscriberMatch,
} from "./fsScanner/index.js";
import { resolveStore, collectStoreNeighbors, type StoreNeighbors } from "./storeLookup.js";

/**
 * Cache entry for project index
 */
interface CacheEntry {
	index: ProjectIndex;
	timestamp: number;
}

/**
 * Service interface for project analysis operations
 */
export interface ProjectAnalysisService {
	/**
	 * Get the full project index for a given root directory
	 * Results are cached for performance
	 */
	getIndex(root: string): Promise<ProjectIndex>;

	/**
	 * Find a store by key (id, name, or id tail)
	 * Returns null if not found
	 */
	getStoreByKey(root: string, key: string, file?: string): Promise<StoreMatch | null>;

	/**
	 * Get all stores and subscribers that are related to the given store
	 * - derivesFrom: stores this store depends on
	 * - dependents: stores that depend on this store
	 * - subscribers: components/hooks/effects using this store
	 */
	getStoreNeighbors(
		root: string,
		store: StoreMatch,
	): Promise<{
		derivesFrom: StoreMatch[];
		dependents: StoreMatch[];
		subscribers: SubscriberMatch[];
	}>;

	/**
	 * Get all store names (extracted from store.name field)
	 * Useful for autocomplete and listing
	 */
	getStoreNames(root: string): Promise<string[]>;

	/**
	 * Clear the cache for a specific root or all roots
	 */
	clearCache(root?: string): void;
}

/**
 * Internal state for the service
 */
interface ProjectAnalysisServiceState {
	cache: Map<string, CacheEntry>;
	cacheTtlMs: number;
}

/**
 * Create a new project analysis service
 *
 * @param cacheTtlMs - Time-to-live for cache entries in milliseconds (default: 30 seconds)
 */
export function createProjectAnalysisService(cacheTtlMs: number = 30_000): ProjectAnalysisService {
	const state: ProjectAnalysisServiceState = {
		cache: new Map(),
		cacheTtlMs,
	};

	/**
	 * Get index from cache or scan project
	 */
	async function getIndexInternal(root: string): Promise<ProjectIndex> {
		const now = Date.now();
		const cached = state.cache.get(root);

		if (cached && now - cached.timestamp < state.cacheTtlMs) {
			return cached.index;
		}

		// Scan project and update cache
		const index = await scanProject(root);
		state.cache.set(root, { index, timestamp: now });

		return index;
	}

	return {
		async getIndex(root: string): Promise<ProjectIndex> {
			return getIndexInternal(root);
		},

		async getStoreByKey(root: string, key: string, file?: string): Promise<StoreMatch | null> {
			const index = await getIndexInternal(root);
			const resolution = resolveStore(index, key, { file });
			return resolution?.store ?? null;
		},

		async getStoreNeighbors(
			root: string,
			store: StoreMatch,
		): Promise<{
			derivesFrom: StoreMatch[];
			dependents: StoreMatch[];
			subscribers: SubscriberMatch[];
		}> {
			const index = await getIndexInternal(root);
			const neighbors: StoreNeighbors = collectStoreNeighbors(index, store);

			return {
				derivesFrom: neighbors.derivesFromStores,
				dependents: neighbors.dependentsStores,
				subscribers: neighbors.subscribers,
			};
		},
		async getStoreNames(root: string): Promise<string[]> {
			const index = await getIndexInternal(root);
			const names: string[] = [];

			for (const store of index.stores) {
				if (store.name) {
					names.push(store.name);
				}
			}

			return Array.from(new Set(names)).sort();
		},

		clearCache(root?: string): void {
			if (root) {
				state.cache.delete(root);
			} else {
				state.cache.clear();
			}
		},
	};
}
