import { scanProject, discoverSourceFiles, getFilesMaxMtime } from "./scanner/index.js";
import { realpathSafe } from "../../config/security.js";
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
 * maxMtime is omitted when staleness is determined by structural file-list changes
 * (additions/deletions/renames) so that getFilesMaxMtime is skipped in those cases.
 * runScan computes it lazily when not provided.
 */
type FreshnessResult =
	| { fresh: true }
	| { fresh: false; files: string[]; maxMtime?: number };

/**
 * Resolve a root path to its canonical, symlink-resolved absolute form.
 * realpathSafe calls normalizeFsPath = path.resolve internally, so both
 * absolute and relative inputs are handled — no explicit isAbsolute guard needed.
 * Must stay in sync with the absRoot computation in scanProject (core.ts).
 */
function toAbsRoot(root: string): string {
	return realpathSafe(root);
}

/**
 * Check whether the cached file list is still up-to-date.
 *
 * Order mirrors the original: structural checks (no stat I/O) first, mtime last.
 * When stale due to file-list changes, maxMtime is omitted so runScan computes it
 * lazily — avoiding stat calls when the list has already changed.
 */
async function checkFreshness(cached: CacheEntry, absRoot: string): Promise<FreshnessResult> {
	const currentFiles = await discoverSourceFiles(absRoot);

	// Structural checks — no stat calls needed
	if (currentFiles.length !== cached.files.length) {
		return { fresh: false, files: currentFiles };
	}
	const cachedSet = new Set(cached.files);
	if (currentFiles.some(f => !cachedSet.has(f))) {
		return { fresh: false, files: currentFiles };
	}

	// File list is identical — check mtime (one stat call per file)
	const maxMtime = await getFilesMaxMtime(currentFiles);
	return maxMtime > cached.maxMtime
		? { fresh: false, files: currentFiles, maxMtime }
		: { fresh: true };
}

/**
 * Create a new project index repository with mtime-based cache invalidation.
 */
export function createProjectIndexRepository(): ProjectIndexRepository {
	const state: ProjectIndexRepositoryState = {
		cache: new Map(),
		inFlight: new Map(),
	};

	/**
	 * Run a scan with in-flight deduplication.
	 * Captures state from the factory closure — no state parameter needed.
	 * If preDiscovered is provided, skips discoverSourceFiles + getFilesMaxMtime.
	 */
	async function runScan(
		absRoot: string,
		opts: ScanOptions | undefined,
		preDiscovered: { files: string[]; maxMtime?: number } | null,
	): Promise<ProjectIndex> {
		const inFlight = state.inFlight.get(absRoot);
		if (inFlight) return inFlight;

		const scanPromise = (async (): Promise<ProjectIndex> => {
			const files = preDiscovered?.files ?? (await discoverSourceFiles(absRoot));
			const maxMtime = preDiscovered?.maxMtime ?? (await getFilesMaxMtime(files));
			const index = await scanProject(absRoot, { ...opts, files });
			state.cache.set(absRoot, { index, files, maxMtime });
			return index;
		})();

		state.inFlight.set(absRoot, scanPromise);

		try {
			return await scanPromise;
		} finally {
			state.inFlight.delete(absRoot);
		}
	}

	return {
		async getIndex(root: string, opts?: ScanOptions): Promise<ProjectIndex> {
			const force = opts?.force ?? false;
			const absRoot = toAbsRoot(root);

			if (!force) {
				const cached = state.cache.get(absRoot);
				if (cached) {
					let freshness: FreshnessResult | null = null;
					try {
						freshness = await checkFreshness(cached, absRoot);
					} catch {
						// freshness check failed — fall through to cold rescan
					}

					if (freshness !== null) {
						if (freshness.fresh) return cached.index;
						// Stale: reuse discovered files to avoid a second discoverSourceFiles call.
						// Destructure to pass only { files, maxMtime } — discards the discriminant.
						const { files, maxMtime } = freshness;
						return runScan(absRoot, opts, { files, maxMtime });
					}
				}
			}

			return runScan(absRoot, opts, null);
		},

		/**
		 * NOTE: when root is provided, toAbsRoot calls fs.realpathSync (blocking I/O).
		 * In practice the MCP tool layer always passes a pre-normalized path from
		 * resolveWorkspaceRoot, so realpathSync is a no-op (path already canonical).
		 */
		clearCache(root?: string): void {
			if (root) {
				state.cache.delete(toAbsRoot(root));
			} else {
				state.cache.clear();
			}
		},
	};
}
