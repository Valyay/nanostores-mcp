import { scanProject, discoverSourceFiles, getFilesMaxMtime } from "./scanner/index.js";
import type { ProjectIndex, ScanOptions } from "./types.js";

/**
 * Cache entry for project index.
 * Stores the discovered file list and max mtime for change detection.
 */
interface CacheEntry {
	index: ProjectIndex;
	files: string[];
	maxMtime: number;
}

/**
 * Repository interface for project index operations
 * Responsible for caching and fetching project indices
 */
export interface ProjectIndexRepository {
	/**
	 * Get the full project index for a given root directory.
	 * Uses mtime-based invalidation: rescans only when files
	 * are added, removed, or modified.
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
	inFlight: Map<string, Promise<ProjectIndex>>;
}

/**
 * Check whether the cached file list is still up-to-date.
 * Returns true if cached index can be reused.
 */
async function isCacheFresh(cached: CacheEntry, root: string): Promise<boolean> {
	const currentFiles = await discoverSourceFiles(root);

	if (currentFiles.length !== cached.files.length) return false;

	const cachedSet = new Set(cached.files);
	for (const f of currentFiles) {
		if (!cachedSet.has(f)) return false;
	}

	const currentMaxMtime = await getFilesMaxMtime(currentFiles);
	return currentMaxMtime <= cached.maxMtime;
}

/**
 * Create a new project index repository with mtime-based cache invalidation.
 */
export function createProjectIndexRepository(): ProjectIndexRepository {
	const state: ProjectIndexRepositoryState = {
		cache: new Map(),
		inFlight: new Map(),
	};

	return {
		async getIndex(root: string, opts?: ScanOptions): Promise<ProjectIndex> {
			const force = opts?.force ?? false;

			if (!force) {
				const cached = state.cache.get(root);
				if (cached) {
					try {
						if (await isCacheFresh(cached, root)) {
							return cached.index;
						}
					} catch {
						// mtime check failed — fall through to rescan
					}
				}
			}

			const inFlight = state.inFlight.get(root);
			if (inFlight) {
				return inFlight;
			}

			const scanPromise = (async (): Promise<ProjectIndex> => {
				const index = await scanProject(root, opts);

				const files = await discoverSourceFiles(root);
				const maxMtime = await getFilesMaxMtime(files);

				state.cache.set(root, { index, files, maxMtime });

				return index;
			})();

			state.inFlight.set(root, scanPromise);

			try {
				return await scanPromise;
			} finally {
				state.inFlight.delete(root);
			}
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
