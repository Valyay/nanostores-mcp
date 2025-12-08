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
 * Internal state for runtime repository (LoggerEventStore)
 */
interface LoggerEventStoreState {
	allEvents: NanostoresLoggerEvent[];
	eventsByStore: Map<string, NanostoresLoggerEvent[]>;
	stats: Map<string, StoreRuntimeStats>;
	maxEvents: number;
	sessionStartedAt: number;
	lastEventAt: number;
}

/**
 * Update statistics for an event
 */
function updateStats(state: LoggerEventStoreState, event: NanostoresLoggerEvent): void {
	const stats = state.stats.get(event.storeName) || {
		storeName: event.storeName,
		storeId: event.storeId,
		firstSeen: event.timestamp,
		lastSeen: event.timestamp,
		mounts: 0,
		unmounts: 0,
		changes: 0,
		actionsStarted: 0,
		actionsErrored: 0,
		actionsCompleted: 0,
	};

	stats.lastSeen = event.timestamp;
	if (event.storeId && !stats.storeId) {
		stats.storeId = event.storeId;
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
			break;
		case "action-end":
			stats.actionsCompleted++;
			break;
		case "action-error":
			stats.actionsErrored++;
			stats.lastError = event;
			break;
	}

	state.stats.set(event.storeName, stats);
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

			// Add to per-store buffer
			const storeEvents = state.eventsByStore.get(event.storeName) || [];
			storeEvents.push(event);
			if (storeEvents.length > 1000) {
				storeEvents.shift();
			}
			state.eventsByStore.set(event.storeName, storeEvents);

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
				events = state.eventsByStore.get(filter.storeName) || [];
			} else {
				events = state.allEvents;
			}

			// Apply filters
			if (filter) {
				events = events.filter(event => {
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
						if (event.kind === "change" && event.actionName !== filter.actionName) {
							return false;
						}
						if (
							(event.kind === "action-start" ||
								event.kind === "action-end" ||
								event.kind === "action-error") &&
							event.actionName !== filter.actionName
						) {
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
		 * Get statistics snapshot
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
		 * Get stats for a specific store
		 */
		getStoreStats(storeName: string): StoreRuntimeStats | undefined {
			return state.stats.get(storeName);
		},

		/**
		 * Clear all events and stats
		 */
		clear(): void {
			state.allEvents = [];
			state.eventsByStore.clear();
			state.stats.clear();
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
