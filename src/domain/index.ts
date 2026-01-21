/**
 * Domain layer public API
 * This is the main entry point for all domain services and repositories
 * Internal structure is kept flexible for future growth
 */

// ============================================================================
// Project Domain
// ============================================================================

export type { ProjectAnalysisService } from "./project/service.js";
export { createProjectAnalysisService } from "./project/service.js";

export type { ProjectIndexRepository } from "./project/repository.js";
export { createProjectIndexRepository } from "./project/repository.js";

// Re-export scanner
export { scanProject } from "./project/scanner/index.js";

// Re-export utilities
export { buildStoreGraph } from "./project/graph.js";
export { resolveStore, collectStoreNeighbors } from "./project/lookup.js";
export { buildGraphOutline, buildIdDictionary, buildStoreSubgraph } from "./project/summary.js";

// Re-export commonly used project types
export type {
	ProjectIndex,
	StoreMatch,
	SubscriberMatch,
	StoreKind,
	StoreResolution,
	StoreNeighbors,
	StoreGraph,
	StoreNode,
	SubscriberNode,
	GraphNode,
} from "./project/types.js";
export type { GraphOutlineResponse, IdDictionaryResponse, StoreSubgraphResponse } from "./project/summary.js";

// ============================================================================
// Docs Domain
// ============================================================================

export type { DocsService } from "./docs/service.js";
export { createDocsService } from "./docs/service.js";

export type { DocsRepository } from "./docs/repository.js";
export { createDocsRepository } from "./docs/repository.js";

export { createFsDocsSource } from "./docs/sourceFs.js";

// Re-export commonly used docs types
export type { DocPage, DocsSearchResult } from "./docs/types.js";

// ============================================================================
// Runtime Domain
// ============================================================================

export type { RuntimeAnalysisService, LoggerEventStore } from "./runtime/types.js";
export { createRuntimeAnalysisService } from "./runtime/service.js";
export { createLoggerEventStore } from "./runtime/eventStore.js";

// Re-export commonly used runtime types
export type {
	NanostoresLoggerEvent,
	BaseEvent,
	MountEvent,
	UnmountEvent,
	ChangeEvent,
	ActionStartEvent,
	ActionEndEvent,
	ActionErrorEvent,
	LoggerEventFilter,
	StoreRuntimeStats,
	EnhancedStoreProfile,
} from "./runtime/types.js";
