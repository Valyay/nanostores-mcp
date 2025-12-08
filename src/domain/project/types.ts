/**
 * Consolidated types for the project domain
 * This file contains all types related to project analysis
 */

// ============================================================================
// Scanner types (base types from scanner)
// ============================================================================

export type StoreKind =
	| "atom"
	| "map"
	| "computed"
	| "persistentAtom"
	| "persistentMap"
	| "atomFamily"
	| "mapTemplate"
	| "computedTemplate"
	| "unknown";

export type SubscriberKind = "component" | "hook" | "effect" | "unknown";

export interface StoreMatch {
	/** Store node identifier in the graph: store:relativePath#name */
	id: string;
	/** File path relative to rootDir */
	file: string;
	line: number;
	kind: StoreKind;
	/** Variable name, e.g. $counter */
	name?: string;
}

export interface SubscriberMatch {
	/** Subscriber identifier: subscriber:relativePath[#Name] */
	id: string;
	file: string;
	line: number;
	kind: SubscriberKind;
	name?: string;
	/** Which stores this subscriber is subscribed to (via subscribes_to relations) */
	storeIds: string[];
}

export type GraphEdgeType = "declares" | "subscribes_to" | "derives_from";

export interface StoreRelation {
	type: GraphEdgeType;
	from: string;
	to: string;
	file?: string;
	line?: number;
}

export interface ProjectIndex {
	rootDir: string;
	filesScanned: number;
	stores: StoreMatch[];
	subscribers: SubscriberMatch[];
	relations: StoreRelation[];
}

/** Callback for reporting scanning progress */
export type ProgressCallback = (progress: number, total: number, message: string) => void;

export interface ScanOptions {
	/** Force rescan, ignoring cache */
	force?: boolean;
	/** Custom cache TTL in milliseconds */
	cacheTtlMs?: number;
	/** Callback for reporting progress */
	onProgress?: ProgressCallback;
}

export function normalizeStoreKind(raw: string): StoreKind {
	switch (raw) {
		case "atom":
		case "map":
		case "computed":
		case "persistentAtom":
		case "persistentMap":
		case "atomFamily":
		case "mapTemplate":
		case "computedTemplate":
			return raw;
		default:
			return "unknown";
	}
}

/**
 * Which StoreKind we consider "derived".
 *
 * Important: we deliberately do NOT include atomFamily/mapTemplate here
 * until we have 100% confidence in their dependency semantics.
 * This reduces the probability of false derives_from relations.
 */
export function isDerivedKind(kind: StoreKind): boolean {
	return kind === "computed" || kind === "computedTemplate";
}

// ============================================================================
// Lookup types
// ============================================================================

export type StoreResolutionBy = "id" | "name" | "id_tail";

export interface StoreResolution {
	store: StoreMatch;
	by: StoreResolutionBy;
	requested: string;
	note?: string;
}

export interface StoreNeighbors {
	subscribers: SubscriberMatch[];
	derivesFromStores: StoreMatch[];
	derivesFromEdges: StoreRelation[];
	dependentsStores: StoreMatch[];
	dependentsEdges: StoreRelation[];
}

// ============================================================================
// Graph types
// ============================================================================

export type GraphNodeType = "file" | "store" | "subscriber";

interface BaseNode {
	id: string;
	type: GraphNodeType;
	label: string;
}

export interface FileNode extends BaseNode {
	type: "file";
	path: string;
}

export interface StoreNode extends BaseNode {
	type: "store";
	file: string;
	kind: StoreKind;
	name?: string;
}

export interface SubscriberNode extends BaseNode {
	type: "subscriber";
	file: string;
	kind: SubscriberKind;
	name?: string;
}

export type GraphNode = FileNode | StoreNode | SubscriberNode;

export type GraphEdge = StoreRelation;

export interface HotStore {
	storeId: string;
	name: string;
	file: string;
	subscribers: number;
	derivedDependents: number;
	totalDegree: number;
}

export interface StoreGraph {
	rootDir: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
	stats: {
		filesWithStores: number;
		totalStores: number;
		subscribers: number;
		edgesByType: Record<GraphEdgeType, number>;
	};
	hotStores: HotStore[];
}
