import { scanProject } from "./scanner/index.js";
import type { ProjectIndex, ScanOptions } from "./types.js";

/**
 * Cache entry for project index
 */
interface CacheEntry {
	index: ProjectIndex;
	timestamp: number;
}

/**
 * Repository interface for project index operations
 * Responsible for caching and fetching project indices
 */
export interface ProjectIndexRepository {
	/**
	 * Get the full project index for a given root directory
	 * Results are cached for performance
	 */
	getIndex(root: string, opts?: ScanOptions): Promise<ProjectIndex>;

	/**
	 * Clear the cache for a specific root or all roots
	 */
	clearCache(root?: string): void;
}

/**
 * Internal state for the repository
 */
interface ProjectIndexRepositoryState {
	cache: Map<string, CacheEntry>;
	cacheTtlMs: number;
}

/**
 * Create a new project index repository
 *
 * @param cacheTtlMs - Time-to-live for cache entries in milliseconds (default: 30 seconds)
 */
export function createProjectIndexRepository(cacheTtlMs: number = 30_000): ProjectIndexRepository {
	const state: ProjectIndexRepositoryState = {
		cache: new Map(),
		cacheTtlMs,
	};

	return {
		async getIndex(root: string, opts?: ScanOptions): Promise<ProjectIndex> {
			const force = opts?.force ?? false;
			const ttl = opts?.cacheTtlMs ?? state.cacheTtlMs;
			const now = Date.now();

			// Check cache unless force is true
			if (!force) {
				const cached = state.cache.get(root);
				if (cached && now - cached.timestamp < ttl) {
					return cached.index;
				}
			}

			// Scan project (without internal caching - scanner is now pure)
			const index = await scanProject(root, opts);

			// Update cache
			state.cache.set(root, { index, timestamp: now });

			return index;
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
