/**
 * Consolidated types for the runtime domain
 * This file aggregates all types related to runtime analysis and logger events
 */

// ============================================================================
// Logger Event Types
// ============================================================================

/**
 * Event types from @nanostores/logger integration
 * Based on buildLogger events API
 */
export type NanostoresLoggerEvent =
	| MountEvent
	| UnmountEvent
	| ChangeEvent
	| ActionStartEvent
	| ActionEndEvent
	| ActionErrorEvent;

export interface BaseEvent {
	storeName: string;
	storeId?: string; // optional: if we can match to AST store id
	timestamp: number;
	sessionId?: string; // to distinguish different tabs/processes
}

export interface MountEvent extends BaseEvent {
	kind: "mount";
}

export interface UnmountEvent extends BaseEvent {
	kind: "unmount";
}

export interface ChangeEvent extends BaseEvent {
	kind: "change";
	actionId?: string;
	actionName?: string;
	changed?: string | string[]; // key(s) that changed in map stores
	newValue?: unknown;
	oldValue?: unknown;
	valueMessage?: string; // compact text description from logger
}

export interface ActionStartEvent extends BaseEvent {
	kind: "action-start";
	actionId: string;
	actionName: string;
	args?: unknown[];
}

export interface ActionEndEvent extends BaseEvent {
	kind: "action-end";
	actionId: string;
	actionName: string;
}

export interface ActionErrorEvent extends BaseEvent {
	kind: "action-error";
	actionId: string;
	actionName: string;
	error?: unknown;
}

// ============================================================================
// Runtime Statistics Types
// ============================================================================

/**
 * Runtime statistics for a single store
 */
export interface StoreRuntimeStats {
	storeName: string;
	storeId?: string;
	firstSeen: number;
	lastSeen: number;
	mounts: number;
	unmounts: number;
	changes: number;
	actionsStarted: number;
	actionsErrored: number;
	actionsCompleted: number;
	lastChange?: ChangeEvent;
	lastError?: ActionErrorEvent;
}

/**
 * Complete runtime profile: static + runtime data
 */
export interface StoreRuntimeProfile {
	id?: string; // from static AST graph
	storeName: string;
	file?: string;
	kind?: "atom" | "map" | "computed" | "unknown";
	stats: StoreRuntimeStats;
	recentEvents: NanostoresLoggerEvent[];
}

/**
 * Extended runtime profile with activity metrics
 */
export interface EnhancedStoreProfile extends StoreRuntimeProfile {
	/**
	 * Changes per second (based on session duration)
	 */
	changeRate: number;

	/**
	 * Error rate as percentage of total actions
	 */
	errorRate: number;

	/**
	 * Whether the store is currently active (recent events within threshold)
	 */
	isActive: boolean;

	/**
	 * Number of seconds since last activity
	 */
	secondsSinceLastActivity: number;
}

/**
 * Snapshot of all runtime statistics
 */
export interface LoggerStatsSnapshot {
	stores: StoreRuntimeStats[];
	totalEvents: number;
	sessionStartedAt: number;
	lastEventAt: number;
}

// ============================================================================
// Filter and Query Types
// ============================================================================

/**
 * Filter options for querying events
 */
export interface LoggerEventFilter {
	storeName?: string;
	storeId?: string;
	kinds?: NanostoresLoggerEvent["kind"][];
	sinceTs?: number;
	untilTs?: number;
	limit?: number;
	actionName?: string;
}

// ============================================================================
// Repository Interface Types
// ============================================================================

/**
 * Runtime repository interface (LoggerEventStore)
 * Responsible for storing and querying runtime events and statistics
 * Analogous to DocsRepository and ProjectIndexRepository in other domains
 */
export interface LoggerEventStore {
	add(event: NanostoresLoggerEvent): void;
	addMany(events: NanostoresLoggerEvent[]): void;
	getEvents(filter?: LoggerEventFilter): NanostoresLoggerEvent[];
	getStats(): LoggerStatsSnapshot;
	getStoreStats(storeName: string): StoreRuntimeStats | undefined;
	clear(): void;
	getNoisyStores(limit?: number): StoreRuntimeStats[];
	getUnmountedStores(): StoreRuntimeStats[];
	getErrorProneStores(minErrors?: number): StoreRuntimeStats[];
}

/**
 * Service interface for runtime analysis operations
 */
export interface RuntimeAnalysisService {
	/**
	 * Get filtered runtime events
	 */
	getEvents(filter?: LoggerEventFilter): NanostoresLoggerEvent[];

	/**
	 * Get overall runtime statistics snapshot
	 */
	getStats(): LoggerStatsSnapshot;

	/**
	 * Get enhanced runtime profile for a specific store
	 * Returns null if store not found in runtime data
	 */
	getStoreProfile(storeName: string): Promise<EnhancedStoreProfile | null>;

	/**
	 * Get profiles for multiple stores
	 */
	getStoreProfiles(storeNames: string[]): Promise<EnhancedStoreProfile[]>;

	/**
	 * Find stores with highest activity
	 */
	getNoisyStores(limit?: number): StoreRuntimeStats[];

	/**
	 * Find stores with errors
	 */
	getErrorProneStores(minErrors?: number): StoreRuntimeStats[];

	/**
	 * Find unmounted stores
	 */
	getUnmountedStores(): StoreRuntimeStats[];
}

/**
 * Options for creating the runtime analysis service
 */
export interface RuntimeAnalysisServiceOptions {
	/**
	 * Threshold in milliseconds to consider a store "active"
	 * Default: 5000 (5 seconds)
	 */
	activeThresholdMs?: number;

	/**
	 * Number of recent events to include in profile
	 * Default: 20
	 */
	recentEventsLimit?: number;
}
