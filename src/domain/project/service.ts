import type { ProjectIndexRepository } from "./repository.js";
import type { ProjectIndex, StoreMatch, SubscriberMatch } from "./types.js";
import { resolveStore, collectStoreNeighbors, type StoreNeighbors } from "./lookup.js";

/**
 * Service interface for project analysis operations
 * This is a domain service layer that provides higher-level operations
 * on top of the ProjectIndexRepository
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
	 * Find a store by runtime key (storeName from logger events)
	 * This tries to match the runtime storeName with static store definitions
	 * Returns null if not found
	 */
	findStoreByRuntimeKey(root: string, storeName: string): Promise<StoreMatch | null>;

	/**
	 * Clear the cache for a specific root or all roots
	 */
	clearCache(root?: string): void;
}

/**
 * Create a new project analysis service
 *
 * @param repository - ProjectIndexRepository instance for fetching project indices
 */
export function createProjectAnalysisService(
	repository: ProjectIndexRepository,
): ProjectAnalysisService {
	return {
		async getIndex(root: string): Promise<ProjectIndex> {
			return repository.getIndex(root);
		},

		async getStoreByKey(root: string, key: string, file?: string): Promise<StoreMatch | null> {
			const index = await repository.getIndex(root);
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
			const index = await repository.getIndex(root);
			const neighbors: StoreNeighbors = collectStoreNeighbors(index, store);

			return {
				derivesFrom: neighbors.derivesFromStores,
				dependents: neighbors.dependentsStores,
				subscribers: neighbors.subscribers,
			};
		},

		async getStoreNames(root: string): Promise<string[]> {
			const index = await repository.getIndex(root);
			const names: string[] = [];

			for (const store of index.stores) {
				if (store.name) {
					names.push(store.name);
				}
			}

			return Array.from(new Set(names)).sort();
		},

		async findStoreByRuntimeKey(root: string, storeName: string): Promise<StoreMatch | null> {
			const index = await repository.getIndex(root);
			
			// Try to match by store.name field
			// Runtime storeName might be with or without $ prefix
			const normalizedName = storeName.startsWith("$") ? storeName : `$${storeName}`;
			const withoutDollar = storeName.startsWith("$") ? storeName.slice(1) : storeName;
			
			// First attempt: exact match with store.name
			for (const store of index.stores) {
				if (store.name === storeName || store.name === normalizedName || store.name === withoutDollar) {
					return store;
				}
			}
			
			// Second attempt: use resolveStore with the name
			const resolution = resolveStore(index, storeName);
			if (resolution?.store) {
				return resolution.store;
			}
			
			return null;
		},

		clearCache(root?: string): void {
			repository.clearCache(root);
		},
	};
}
