import type { LoggerEventStore } from "./types.js";
import type { ProjectAnalysisService } from "../index.js";
import type {
	NanostoresLoggerEvent,
	LoggerEventFilter,
	LoggerStatsSnapshot,
	StoreRuntimeStats,
	StoreRuntimeProfile,
	EnhancedStoreProfile,
	RuntimeAnalysisService,
	RuntimeAnalysisServiceOptions,
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
	): Promise<EnhancedStoreProfile> {
		const now = Date.now();
		const metrics = calculateMetrics(stats, now);

		// Get recent events
		const recentEvents = eventStore.getEvents({
			storeName,
			limit: recentEventsLimit,
		});

		// Try to enrich with static analysis data
		// Note: We need a root directory - in practice this should be provided by context
		// For now, we'll leave static fields as optional
		const profile: EnhancedStoreProfile = {
			storeName,
			stats,
			recentEvents,
			...metrics,
		};

		return profile;
	}

	return {
		getEvents(filter?: LoggerEventFilter): NanostoresLoggerEvent[] {
			return eventStore.getEvents(filter);
		},

		getStats(): LoggerStatsSnapshot {
			return eventStore.getStats();
		},

		async getStoreProfile(storeName: string): Promise<EnhancedStoreProfile | null> {
			const stats = eventStore.getStoreStats(storeName);
			if (!stats) {
				return null;
			}

			return buildEnhancedProfile(storeName, stats);
		},

		async getStoreProfiles(storeNames: string[]): Promise<EnhancedStoreProfile[]> {
			const profiles: EnhancedStoreProfile[] = [];

			for (const storeName of storeNames) {
				const profile = await this.getStoreProfile(storeName);
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
	};
}
