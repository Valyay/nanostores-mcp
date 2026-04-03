# Changelog

## 0.1.0

Initial release of Nano Stores MCP server.

### Static Analysis

- AST-based project scanning with dependency graphs and store inspection.
- Detection of all store kinds: `atom`, `map`, `deepMap`, `computed`, `batched`, `mapTemplate`, `router`, and ecosystem packages (`@nanostores/router`, `@nanostores/i18n`, `@nanostores/persistent`).
- Dead store and hub breakdown in project outline.
- Angular, Vue, and Svelte subscriber detection.

### Runtime Monitoring

- Live event streaming from `@nanostores/logger` via loopback-restricted TCP.
- Store activity tracking with action duration metrics.
- Runtime coverage tool for identifying unmonitored stores.

### Documentation

- Integrated Nanostores docs search with word-boundary matching and IDF scoring.
- Auto-detection for documentation source.

### MCP Interface

- 11 tools: `scan_project`, `project_outline`, `store_summary`, `store_subgraph`, `store_activity`, `find_noisy_stores`, `runtime_overview`, `runtime_coverage`, `docs_search`, `clear_cache`, `ping`.
- 5 prompts: `explain-project`, `explain-store`, `debug-store`, `debug-project-activity`, `docs-how-to`.
- Resources for store details, dependency graph, and documentation pages.
- Server instructions with cost hierarchy for tool selection.

### Infrastructure

- CLI entry point (`npx nanostores-mcp`).
- `mcpLogger` client integration for `@nanostores/logger`.
- Multi-project workspace support with client roots management.
- Mtime-based cache invalidation.
