# Changelog

## 0.1.0

Initial release of Nano Stores MCP server.

### Static Analysis

- AST-based project scanning with dependency graphs and store inspection.
- Detection of all store kinds: `atom`, `map`, `deepMap`, `computed`, `batched`, `mapTemplate`, `router`, and ecosystem packages (`@nanostores/router`, `@nanostores/i18n`, `@nanostores/persistent`).
- Nested store declarations scanned (stores declared inside function bodies are indexed and flagged).
- Subscriber detection: `useStore`, `.subscribe()`, `.listen()`, `onMount`, `onSet`, Angular/Vue/Svelte bindings, and Svelte `$store` template references.
- Dead store classification fix: degree counting now correctly excludes `declares` edges, so dead stores are no longer always empty.
- `nanostores_project_outline` hub stores ranked by weighted connectivity score (subscribers + derived dependents + mutators); `mutators` field added to each hub entry.
- `nanostores_project_outline` gains `coOccurringPairs` (stores consistently appearing together in subscribers), `topSemanticAnomalies` (stores with the highest anomaly score based on semantic flags), and `topBlindSpots` (stores appearing unreferenced, categorized by most likely reason: `possibly_svelte_reactive`, `factory_local`, `story_or_test_scoped`, `imperative_only`, `truly_unreferenced_candidate`).

#### Semantic store flags

Flags surfaced on individual stores in `store_summary` and `project_outline` output:

- `computedHasSideEffects` — computed callback calls `.set`, `.subscribe`, `setTimeout`, etc.
- `computedHasCleanupCalls` — computed callback calls `.destroy()` (lifecycle pattern).
- `isInsideFactory` — store declared inside a function body; may be per-instance state.
- `hasMountDependentActivation` — `onMount()` detected; behavior only activates when the store has live subscribers.
- `writtenWithoutSubscribers` — mutators exist but no reactive subscribers detected.
- `readViaGetOnly` — only `.get()` calls detected, no `useStore`/`subscribe`; imperative access pattern.
- `storyOrTestOnlyWriter` — all detected mutations come from test or story files.

#### Imperative-read detection

- `.get()` call sites tracked across all source files.
- Symbol-first resolution with name-based fallback and same-file disambiguation.
- Powers the `readViaGetOnly` flag; distinguishes polling/service reads from reactive subscriptions.

### Static Analysis Blind Spots (documented in server instructions)

Server instructions now include an explicit section on patterns the static scanner cannot detect: `onMount`/`onSet`/`keepMount` hooks, factory-destructured stores, `atomFamily`/`mapTemplate` instances, dynamic imports, CommonJS `require`, default import style, `onSet`-driven reactive chains, `batch()` boundaries, and indirect mutations via wrapper functions.

### Runtime Monitoring

- Live event streaming from `@nanostores/logger` via loopback-restricted TCP.
- Store activity tracking with action duration metrics.
- Runtime coverage tool for identifying unmonitored stores.

### Documentation

- Integrated Nanostores docs search with word-boundary matching and IDF scoring.
- Auto-detection for documentation source.

### MCP Interface

- 12 tools: `nanostores_scan_project`, `nanostores_project_outline`, `nanostores_store_summary`, `nanostores_store_subgraph`, `nanostores_store_impact`, `nanostores_store_activity`, `nanostores_find_noisy_stores`, `nanostores_runtime_overview`, `nanostores_runtime_coverage`, `nanostores_docs_search`, `nanostores_clear_cache`, `nanostores_ping`.
- `nanostores_store_impact` traces the downstream causal chain from a single store: which computed stores recompute at hop 1, their dependents at hop 2, and so on. Subscribers appear at the same hop as the store they react to.
- 5 prompts: `explain-project`, `explain-store`, `debug-store`, `debug-project-activity`, `docs-how-to`.
- Resources for store details, dependency graph, and documentation pages.
- Server instructions follow a data-driven analysis approach: structural signals are presented as hypotheses to validate, not conclusions. Instructions include tool selection heuristics, structural signal reference, semantic flag reference, and a blind-spot section.

### Infrastructure

- CLI entry point (`npx nanostores-mcp`).
- `mcpLogger` client integration for `@nanostores/logger`.
- Multi-project workspace support with client roots management.
- Mtime-based cache invalidation.
