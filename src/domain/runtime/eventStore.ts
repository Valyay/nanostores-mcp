import type {
	ChangeEvent,
	LoggerEventFilter,
	LoggerStatsSnapshot,
	NanostoresLoggerEvent,
	StoreRuntimeStats,
	LoggerEventStore,
} from "./types.js";

export type { LoggerEventStore };

/**
 * Composite key for per-store maps to prevent collisions when multiple project roots
 * share the same store name (e.g. $user in /app/project1 and /app/project2).
 * Null byte (\0) is used as a separator — it cannot appear in file paths or JS identifiers.
 */
export function makeStoreKey(projectRoot: string | undefined, storeName: string): string {
	return `${projectRoot ?? ""}\0${storeName}`;
}

/**
 * Internal state for runtime repository (LoggerEventStore)
 */
interface LoggerEventStoreState {
	allEvents: NanostoresLoggerEvent[];
	eventsByStore: Map<string, NanostoresLoggerEvent[]>;
	stats: Map<string, StoreRuntimeStats>;
	/** Tracks in-flight action start timestamps: actionId → timestamp */
	actionStartTimes: Map<string, number>;
	maxEvents: number;
	sessionStartedAt: number;
	lastEventAt: number;
}

/**
 * Update statistics for an event
 */
function updateStats(state: LoggerEventStoreState, event: NanostoresLoggerEvent): void {
	const key = makeStoreKey(event.projectRoot, event.storeName);
	const stats = state.stats.get(key) || {
		storeName: event.storeName,
		storeId: event.storeId,
		projectRoot: event.projectRoot,
		firstSeen: event.timestamp,
		lastSeen: event.timestamp,
		mounts: 0,
		unmounts: 0,
		changes: 0,
		actionsStarted: 0,
		actionsErrored: 0,
		actionsCompleted: 0,
		totalActionDurationMs: 0,
		maxActionDurationMs: 0,
		minActionDurationMs: 0,
	};

	stats.lastSeen = event.timestamp;
	if (event.storeId && !stats.storeId) {
		stats.storeId = event.storeId;
	}
	if (event.projectRoot && !stats.projectRoot) {
		stats.projectRoot = event.projectRoot;
	}

	switch (event.kind) {
		case "mount":
			stats.mounts++;
			break;
		case "unmount":
			stats.unmounts++;
			break;
		case "change":
			stats.changes++;
			stats.lastChange = event as ChangeEvent;
			break;
		case "action-start":
			stats.actionsStarted++;
			state.actionStartTimes.set(event.actionId, event.timestamp);
			break;
		case "action-end":
			stats.actionsCompleted++;
			{
				const startTime = state.actionStartTimes.get(event.actionId);
				if (startTime !== undefined) {
					const duration = event.timestamp - startTime;
					stats.totalActionDurationMs += duration;
					if (duration > stats.maxActionDurationMs) stats.maxActionDurationMs = duration;
					if (duration < stats.minActionDurationMs || stats.minActionDurationMs === 0) {
						stats.minActionDurationMs = duration;
					}
					state.actionStartTimes.delete(event.actionId);
				}
			}
			break;
		case "action-error":
			stats.actionsErrored++;
			stats.lastError = event;
			{
				const startTime = state.actionStartTimes.get(event.actionId);
				if (startTime !== undefined) {
					const duration = event.timestamp - startTime;
					stats.totalActionDurationMs += duration;
					if (duration > stats.maxActionDurationMs) stats.maxActionDurationMs = duration;
					state.actionStartTimes.delete(event.actionId);
				}
			}
			break;
	}

	state.stats.set(key, stats);
}

/**
 * Create runtime repository (LoggerEventStore)
 * In-memory ring buffer for logger events with statistics aggregation
 * This is the runtime domain's repository layer, analogous to DocsRepository and ProjectIndexRepository
 */
export function createLoggerEventStore(maxEvents: number = 5000): LoggerEventStore {
	const state: LoggerEventStoreState = {
		allEvents: [],
		eventsByStore: new Map(),
		stats: new Map(),
		actionStartTimes: new Map(),
		maxEvents,
		sessionStartedAt: Date.now(),
		lastEventAt: Date.now(),
	};

	return {
		/**
		 * Add a single event
		 */
		add(event: NanostoresLoggerEvent): void {
			state.lastEventAt = event.timestamp;

			// Add to global buffer
			state.allEvents.push(event);
			if (state.allEvents.length > state.maxEvents) {
				state.allEvents.shift();
			}

			// Add to per-store buffer (keyed by composite projectRoot+storeName)
			const storeKey = makeStoreKey(event.projectRoot, event.storeName);
			const storeEvents = state.eventsByStore.get(storeKey) || [];
			storeEvents.push(event);
			if (storeEvents.length > 1000) {
				storeEvents.shift();
			}
			state.eventsByStore.set(storeKey, storeEvents);

			// Update statistics
			updateStats(state, event);
		},

		/**
		 * Add multiple events (batch)
		 */
		addMany(events: NanostoresLoggerEvent[]): void {
			for (const event of events) {
				this.add(event);
			}
		},

		/**
		 * Get events matching filter
		 */
		getEvents(filter?: LoggerEventFilter): NanostoresLoggerEvent[] {
			let events: NanostoresLoggerEvent[];

			// Start with the right subset
			if (filter?.storeName) {
				if (filter.projectRoot !== undefined) {
					// Try exact composite-key first; fall back to rootless (project-agnostic) events.
					// Use `!== undefined` not `?.length` — an empty bucket is valid and must not
					// silently fall through to rootless events (which belong to a different root).
					const exact = state.eventsByStore.get(makeStoreKey(filter.projectRoot, filter.storeName));
					events =
						exact !== undefined
							? exact
							: (state.eventsByStore.get(makeStoreKey(undefined, filter.storeName)) ?? []);
				} else {
					// No projectRoot: merge events from all roots for this store name.
					// O(total composite keys) — acceptable for dev-tool scale (≤ ~2000 keys).
					// If multi-root scale grows, add a secondary Map<storeName, compositeKey[]> index.
					const suffix = `\0${filter.storeName}`;
					const collected: NanostoresLoggerEvent[] = [];
					for (const [key, evs] of state.eventsByStore) {
						if (key.endsWith(suffix)) {
							collected.push(...evs);
						}
					}
					events = collected.sort((a, b) => a.timestamp - b.timestamp);
				}
			} else {
				events = state.allEvents;
			}

			// Apply filters
			if (filter) {
				events = events.filter(event => {
					// Rootless events (no projectRoot) are project-agnostic — never filtered out by projectRoot
					if (
						filter.projectRoot !== undefined &&
						event.projectRoot !== undefined &&
						event.projectRoot !== filter.projectRoot
					) {
						return false;
					}
					if (filter.kinds && !filter.kinds.includes(event.kind)) {
						return false;
					}
					if (filter.storeId && event.storeId !== filter.storeId) {
						return false;
					}
					if (filter.sinceTs && event.timestamp < filter.sinceTs) {
						return false;
					}
					if (filter.untilTs && event.timestamp > filter.untilTs) {
						return false;
					}
					if (filter.actionName) {
						if (
							event.kind !== "change" &&
							event.kind !== "action-start" &&
							event.kind !== "action-end" &&
							event.kind !== "action-error"
						) {
							return false;
						}
						if (event.actionName !== filter.actionName) {
							return false;
						}
					}
					return true;
				});
			}

			// Apply limit from the end (most recent)
			if (filter?.limit && events.length > filter.limit) {
				events = events.slice(-filter.limit);
			}

			return events;
		},

		/**
		 * Get statistics snapshot.
		 * NOTE: In multi-root setups, stores.storeName is NOT unique — the same
		 * storeName may appear once per root. Callers that build Map<storeName, …>
		 * or display storeName without a root label should use makeStoreKey().
		 */
		getStats(): LoggerStatsSnapshot {
			return {
				stores: Array.from(state.stats.values()),
				totalEvents: state.allEvents.length,
				sessionStartedAt: state.sessionStartedAt,
				lastEventAt: state.lastEventAt,
			};
		},

		/**
		 * Get stats for a specific store.
		 * With projectRoot: tries exact composite-key first, then falls back to rootless
		 *   entry (events sent without projectRoot are treated as project-agnostic).
		 * Without projectRoot: scans all entries for first match (ambiguous in multi-root).
		 */
		getStoreStats(storeName: string, projectRoot?: string): StoreRuntimeStats | undefined {
			if (projectRoot !== undefined) {
				return (
					state.stats.get(makeStoreKey(projectRoot, storeName)) ??
					state.stats.get(makeStoreKey(undefined, storeName))
				);
			}
			// No projectRoot: scan all entries for first match (single-root compat)
			for (const [key, stats] of state.stats) {
				if (key.endsWith(`\0${storeName}`)) {
					return stats;
				}
			}
			return undefined;
		},

		/**
		 * Clear all events and stats
		 */
		clear(): void {
			state.allEvents = [];
			state.eventsByStore.clear();
			state.stats.clear();
			state.actionStartTimes.clear();
			state.sessionStartedAt = Date.now();
			state.lastEventAt = state.sessionStartedAt;
		},

		/**
		 * Get stores sorted by activity (changes + actions)
		 */
		getNoisyStores(limit: number = 10): StoreRuntimeStats[] {
			const stores = Array.from(state.stats.values());
			stores.sort((a, b) => {
				const activityA = a.changes + a.actionsStarted;
				const activityB = b.changes + b.actionsStarted;
				return activityB - activityA;
			});
			return stores.slice(0, limit);
		},

		/**
		 * Get stores that have never been mounted
		 */
		getUnmountedStores(): StoreRuntimeStats[] {
			return Array.from(state.stats.values()).filter(s => s.mounts === 0);
		},

		/**
		 * Get stores with high error rates
		 */
		getErrorProneStores(minErrors: number = 3): StoreRuntimeStats[] {
			return Array.from(state.stats.values())
				.filter(s => s.actionsErrored >= minErrors)
				.sort((a, b) => b.actionsErrored - a.actionsErrored);
		},
	};
}
