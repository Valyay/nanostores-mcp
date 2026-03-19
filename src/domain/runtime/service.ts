import type { LoggerEventStore } from "./types.js";
import type { ProjectAnalysisService } from "../index.js";
import type {
	NanostoresLoggerEvent,
	LoggerEventFilter,
	LoggerStatsSnapshot,
	StoreRuntimeStats,
	EnhancedStoreProfile,
	RuntimeAnalysisService,
	RuntimeAnalysisServiceOptions,
	CoverageReport,
	StoreCoverageEntry,
} from "./types.js";

export type { RuntimeAnalysisService, RuntimeAnalysisServiceOptions, EnhancedStoreProfile };

/**
 * Create a new runtime analysis service
 * This service layer operates on top of the runtime repository (LoggerEventStore)
 */
export function createRuntimeAnalysisService(
	eventStore: LoggerEventStore,
	projectService: ProjectAnalysisService,
	options: RuntimeAnalysisServiceOptions = {},
): RuntimeAnalysisService {
	const activeThresholdMs = options.activeThresholdMs ?? 5000;
	const recentEventsLimit = options.recentEventsLimit ?? 20;

	/**
	 * Calculate activity metrics for a store
	 */
	function calculateMetrics(
		stats: StoreRuntimeStats,
		now: number,
	): {
		changeRate: number;
		errorRate: number;
		isActive: boolean;
		secondsSinceLastActivity: number;
	} {
		const sessionDurationSec = Math.max(1, (stats.lastSeen - stats.firstSeen) / 1000);
		const changeRate = stats.changes / sessionDurationSec;

		const totalActions = stats.actionsStarted || 1; // avoid division by zero
		const errorRate = (stats.actionsErrored / totalActions) * 100;

		const timeSinceLastSec = (now - stats.lastSeen) / 1000;
		const isActive = timeSinceLastSec * 1000 < activeThresholdMs;

		return {
			changeRate,
			errorRate,
			isActive,
			secondsSinceLastActivity: timeSinceLastSec,
		};
	}

	/**
	 * Build enhanced profile for a store
	 */
	async function buildEnhancedProfile(
		storeName: string,
		stats: StoreRuntimeStats,
		projectRootOverride?: string,
	): Promise<EnhancedStoreProfile> {
		const now = Date.now();
		const metrics = calculateMetrics(stats, now);

		// Get recent events — pass projectRoot to avoid cross-root mixing
		const recentEvents = eventStore.getEvents({
			storeName,
			projectRoot: projectRootOverride || stats.projectRoot,
			limit: recentEventsLimit,
		});

		// Base profile with runtime data
		const profile: EnhancedStoreProfile = {
			storeName,
			stats,
			recentEvents,
			...metrics,
		};

		// Try to enrich with static analysis data if projectRoot is available
		const effectiveRoot = projectRootOverride || stats.projectRoot;
		if (effectiveRoot && projectService) {
			try {
				const staticStore = await projectService.findStoreByRuntimeKey(effectiveRoot, storeName);

				if (staticStore) {
					profile.id = staticStore.id;
					profile.kind = staticStore.kind;
					profile.file = staticStore.file;
					profile.projectRoot = effectiveRoot;
				}
			} catch {
				// Silently ignore errors - static data is optional
				// This allows runtime analysis to work without project scanning
			}
		}

		return profile;
	}

	return {
		getEvents(filter?: LoggerEventFilter): NanostoresLoggerEvent[] {
			return eventStore.getEvents(filter);
		},

		getStats(): LoggerStatsSnapshot {
			return eventStore.getStats();
		},

		async getStoreProfile(
			storeName: string,
			projectRoot?: string,
		): Promise<EnhancedStoreProfile | null> {
			const stats = eventStore.getStoreStats(storeName, projectRoot);
			if (!stats) {
				return null;
			}

			return buildEnhancedProfile(storeName, stats, projectRoot);
		},

		async getStoreProfiles(
			storeNames: string[],
			projectRoot?: string,
		): Promise<EnhancedStoreProfile[]> {
			const profiles: EnhancedStoreProfile[] = [];

			for (const storeName of storeNames) {
				const profile = await this.getStoreProfile(storeName, projectRoot);
				if (profile) {
					profiles.push(profile);
				}
			}

			return profiles;
		},

		getNoisyStores(limit?: number): StoreRuntimeStats[] {
			return eventStore.getNoisyStores(limit);
		},

		getErrorProneStores(minErrors?: number): StoreRuntimeStats[] {
			return eventStore.getErrorProneStores(minErrors);
		},

		getUnmountedStores(): StoreRuntimeStats[] {
			return eventStore.getUnmountedStores();
		},

		async getCoverageReport(projectRoot: string): Promise<CoverageReport> {
			// 1. Get static stores
			let staticStores: Array<{ id: string; file: string; kind: string; name?: string }> = [];
			try {
				const index = await projectService.getIndex(projectRoot);
				staticStores = index.stores;
			} catch {
				// Static analysis unavailable — report will be runtime-only
			}

			// 2. Get runtime stores filtered by projectRoot
			const allRuntimeStats = eventStore.getStats().stores;
			const runtimeByName = new Map<string, StoreRuntimeStats>();
			for (const s of allRuntimeStats) {
				if (s.projectRoot === projectRoot || s.projectRoot === undefined) {
					runtimeByName.set(s.storeName, s);
				}
			}

			// 3. Build static map by name
			const staticByName = new Map<string, (typeof staticStores)[0]>();
			for (const s of staticStores) {
				if (s.name) {
					staticByName.set(s.name, s);
				}
			}

			// 4. Join: union of all names from both sets
			const allNames = new Set<string>([...staticByName.keys(), ...runtimeByName.keys()]);
			const stores: StoreCoverageEntry[] = [];
			const coverageByKind: Record<string, { total: number; covered: number }> = {};

			for (const name of allNames) {
				const staticStore = staticByName.get(name);
				const runtimeStats = runtimeByName.get(name);
				const inStaticGraph = !!staticStore;
				const inRuntime = !!runtimeStats;

				stores.push({
					storeName: name,
					storeId: staticStore?.id,
					kind: staticStore?.kind as StoreCoverageEntry["kind"],
					file: staticStore?.file,
					inStaticGraph,
					inRuntime,
					runtimeChanges: runtimeStats?.changes,
					runtimeMounts: runtimeStats?.mounts,
				});

				// Aggregate by kind (only for static stores)
				if (staticStore) {
					const kind = staticStore.kind;
					if (!coverageByKind[kind]) {
						coverageByKind[kind] = { total: 0, covered: 0 };
					}
					coverageByKind[kind].total++;
					if (inRuntime) {
						coverageByKind[kind].covered++;
					}
				}
			}

			const coveredCount = stores.filter(s => s.inStaticGraph && s.inRuntime).length;
			const staticOnlyCount = stores.filter(s => s.inStaticGraph && !s.inRuntime).length;
			const runtimeOnlyCount = stores.filter(s => !s.inStaticGraph && s.inRuntime).length;

			return {
				projectRoot,
				staticStoreCount: staticByName.size,
				runtimeStoreCount: runtimeByName.size,
				coveredCount,
				staticOnlyCount,
				runtimeOnlyCount,
				coverageByKind,
				stores,
			};
		},
	};
}
