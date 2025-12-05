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
	actionId?: number;
	actionName?: string;
	changed?: string | string[]; // key(s) that changed in map stores
	newValue?: unknown;
	oldValue?: unknown;
	valueMessage?: string; // compact text description from logger
}

export interface ActionStartEvent extends BaseEvent {
	kind: "action-start";
	actionId: number;
	actionName: string;
	args?: unknown[];
}

export interface ActionEndEvent extends BaseEvent {
	kind: "action-end";
	actionId: number;
	actionName: string;
}

export interface ActionErrorEvent extends BaseEvent {
	kind: "action-error";
	actionId: number;
	actionName: string;
	error?: unknown;
}

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
 * Snapshot of all runtime statistics
 */
export interface LoggerStatsSnapshot {
	stores: StoreRuntimeStats[];
	totalEvents: number;
	sessionStartedAt: number;
	lastEventAt: number;
}

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
