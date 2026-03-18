# Nano Stores MCP

<img align="right" width="92" height="92" title="Nano Stores logo"
     src="https://nanostores.github.io/nanostores/logo.svg">

**Model Context Protocol server for Nanostores** — analyze, debug and monitor
your nanostores in AI assistants like Claude Desktop.

- **📊 Static Analysis:** AST-based project scanning, dependency graphs, store inspection
- **🔥 Runtime Monitoring:** Live events from `@nanostores/logger`, performance metrics, activity tracking
- **📚 Documentation:** Search and browse Nanostores docs by topic or store kind
- **🎯 Zero Config:** Works out of the box — auto-detects project roots and nanostores docs

```bash
npx nanostores-mcp
```

Ask your AI: _"Show me the dependency graph"_ or _"Which stores are causing the most re-renders?"_

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
- [MCP Interface](#mcp-interface)
  - [Resources](#mcp-resources)
  - [Tools](#mcp-tools)
  - [Prompts](#mcp-prompts)
- [Runtime Monitoring](#runtime-monitoring)
- [Example Queries](#example-queries)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Features

### 📊 Static Analysis (AST-based)

Understand your nanostores architecture without running your app:

- **Project scanning** — find all stores, subscribers, and import/export relationships
- **Dependency graph** — visualize how stores depend on each other (Mermaid diagrams)
- **Store inspection** — type (atom/map/computed), location, usage patterns, related files

### 🔥 Runtime Monitoring (Logger Integration)

Real-time insights into your running application:

- **Live event capture** — mount/unmount, value changes, action calls from `@nanostores/logger`
- **Performance analysis** — find noisy stores, high error rates, performance bottlenecks
- **Activity metrics** — change frequency, action success/failure rates, mount duration
- **Combined analysis** — merge static structure with runtime behavior for deep debugging

### 📚 Documentation Search

Search and browse Nanostores documentation directly from your AI assistant:

- **Full-text search** — find guides, API references, and best practices by query
- **Store-kind lookup** — get docs relevant to a specific store type (atom, map, computed, etc.)
- **Auto-detection** — picks up docs from `nanostores` in your `node_modules` automatically

## Installation

```bash
npm install -g nanostores-mcp
# or
pnpm add -g nanostores-mcp
```

Or run directly without installation:

```bash
npx nanostores-mcp
```

## Configuration

Add to your MCP client config (e.g., Claude Desktop):

```json
{
	"mcpServers": {
		"nanostores": {
			"command": "npx",
			"args": ["nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project"
			}
		}
	}
}
```

### Environment Variables

| Variable                        | Default     | Description                                   |
| ------------------------------- | ----------- | --------------------------------------------- |
| `NANOSTORES_MCP_ROOT`           | cwd         | Project root path                             |
| `NANOSTORES_MCP_ROOTS`          | —           | Platform-delimited roots (`:` on Unix, `;` on Windows) for multi-project setup |
| `NANOSTORES_MCP_LOGGER_ENABLED` | `false`     | Enable runtime event collection               |
| `NANOSTORES_MCP_LOGGER_PORT`    | `3999`      | HTTP port for logger bridge                   |
| `NANOSTORES_MCP_LOGGER_HOST`    | `127.0.0.1` | Host to bind (loopback only)                  |
| `NANOSTORES_DOCS_ROOT`          | auto-detect | Path to documentation directory               |
| `NANOSTORES_DOCS_PATTERNS`      | `**/*.md`   | Comma-separated glob patterns for docs        |

## Quick Start

### 1. Static Analysis

Works out of the box — just point at your project:

```
Call tool: nanostores_scan_project
Call tool: nanostores_store_summary  { "name": "$counter" }

Read resource: nanostores://graph
Read resource: nanostores://store/$counter
```

### 2. Documentation Search

Auto-detected from `nanostores` in your `node_modules`:

```
Call tool: nanostores_docs_search  { "query": "computed stores" }
Call tool: nanostores_docs_search  { "storeKind": "persistentAtom" }

Read resource: nanostores://docs
Read resource: nanostores://docs/page/guide/atom
```

### 3. Runtime Monitoring (Optional)

Requires logger integration in your app. See [Runtime Monitoring](#runtime-monitoring) below.

```
Call tool: nanostores_runtime_overview
Call tool: nanostores_find_noisy_stores
Call tool: nanostores_store_activity  { "storeName": "counter" }
```

## MCP Interface

### MCP Resources

| Resource                      | Description                              |
| ----------------------------- | ---------------------------------------- |
| `nanostores://graph`          | Full dependency graph (text + Mermaid)   |
| `nanostores://store/{key}`    | Store details by name or id              |
| `nanostores://docs`           | Documentation index — all pages and tags |
| `nanostores://docs/page/{id}` | Full content of a documentation page     |

### MCP Tools

**Static Analysis**

| Tool                         | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `nanostores_scan_project`    | Scan project for all stores, subscribers, and dependencies    |
| `nanostores_store_summary`   | Detailed summary of a specific store                          |
| `nanostores_project_outline` | High-level overview: store kinds, top directories, hub stores |
| `nanostores_store_subgraph`  | BFS-expanded dependency neighborhood of a store               |

**Runtime Monitoring**

| Tool                           | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `nanostores_runtime_overview`  | Overall health report with statistics for all stores               |
| `nanostores_store_activity`    | Activity timeline for a specific store (filterable by kind/action) |
| `nanostores_find_noisy_stores` | Identify stores with high change frequency or error rates          |

**Documentation**

| Tool                     | Parameters            | Description                                                            |
| ------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `nanostores_docs_search` | `query`               | Full-text search across documentation                                  |
|                          | `storeKind`           | Find docs for a store type (atom, map, computed, persistentAtom, etc.) |
|                          | `query` + `storeKind` | Search scoped to store-relevant pages                                  |
|                          | `limit`, `tags`       | Optional filtering                                                     |

Use `nanostores://docs/page/{id}` resource to read the full content of pages returned by search.

**Utilities**

| Tool                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `ping`                   | Server health check and logger bridge status |
| `nanostores_clear_cache` | Clear project index cache to force rescan    |

### MCP Prompts

| Prompt                              | Description                                                |
| ----------------------------------- | ---------------------------------------------------------- |
| `explain-project`        | AI-guided explanation of your project's store architecture |
| `explain-store`          | Deep dive into a specific store's implementation and usage |
| `debug-store`            | Comprehensive analysis combining static + runtime data     |
| `debug-project-activity` | Project-wide performance analysis and optimization         |
| `docs-how-to`            | Step-by-step guidance for Nanostores tasks, backed by docs |

## Runtime Monitoring

For runtime analysis, integrate the MCP Logger client into your application.

**1. Install in your app and enable the logger bridge:**

```bash
npm install nanostores-mcp
```

```json
{
	"mcpServers": {
		"nanostores": {
			"command": "npx",
			"args": ["nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project",
				"NANOSTORES_MCP_LOGGER_ENABLED": "true"
			}
		}
	}
}
```

**2. Define stores with logger attached** (`src/stores.ts`):

```typescript
import { atom, map, computed } from "nanostores";
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";

// Automatically disabled in production (checks NODE_ENV / import.meta.env.DEV)
initMcpLogger();

// Stores
export const $count = atom(0);
export const $user = map({ name: "", role: "guest" });
export const $greeting = computed($user, user => `Hello, ${user.name}`);

// Attach logger — each call returns a cleanup function
attachMcpLogger($count, "count");
attachMcpLogger($user, "user");
attachMcpLogger($greeting, "greeting");
```

**3. Use stores normally** — events (mount, unmount, change, actions) are captured automatically and batched to the MCP server every second.

**4. Ask your AI assistant:**

- _"Which stores change most frequently?"_ → `nanostores_find_noisy_stores`
- _"Show me recent activity for $user"_ → `nanostores_store_activity`
- _"Give me an overall health report"_ → `nanostores_runtime_overview`

### Logger Options

```typescript
initMcpLogger({
	url: "http://localhost:4000/nanostores-logger", // custom port
	batchMs: 500, // faster batching
	projectRoot: "/absolute/path/to/project", // link with static analysis

	// Mask sensitive data — return null to skip event entirely
	maskEvent: event => {
		if (event.storeName === "authToken") return null;
		return event;
	},
});
```

### Flush Before Shutdown

```typescript
import { getMcpLogger } from "nanostores-mcp/mcpLogger";

window.addEventListener("beforeunload", () => {
	getMcpLogger()?.forceFlush();
});
```

## Example Queries

Ask your AI assistant natural language questions:

**Static Analysis:**

- _"Show me the dependency graph for my nanostores"_
- _"Explain what the $cart store does"_
- _"Which stores depend on $user?"_
- _"List all stores in my project"_

**Runtime Debugging:**

- _"Which stores are causing the most re-renders?"_
- _"Debug the $user store with both static and runtime data"_
- _"Show me recent activity for $cart"_
- _"Find performance bottlenecks in my stores"_

**Documentation:**

- _"How do I use computed stores?"_
- _"Show me docs about persistent stores"_
- _"Find docs for the atom store kind"_

## Architecture

```
┌──────────────────────┐
│   Your Application   │
│                      │
│  @nanostores/logger  │
│        events        │
└──────────┬───────────┘
           │ HTTP POST (localhost:3999)
           ▼
┌──────────────────────┐
│   nanostores-mcp     │
│                      │
│   ┌──────────────┐   │
│   │ Logger Bridge │   │ ← HTTP server for runtime events
│   └──────┬───────┘   │
│          ▼           │
│   ┌──────────────┐   │
│   │ Event Store  │   │ ← Ring buffer (5000 events) + stats
│   └──────┬───────┘   │
│          │           │
│   ┌──────┴───────┐   │
│   │  AST Scanner │   │ ← ts-morph static analysis
│   └──────┬───────┘   │
│          │           │
│   ┌──────┴───────┐   │
│   │  Docs Index  │   │ ← Auto-detected from node_modules
│   └──────┬───────┘   │
│          │           │
│   ┌──────┴───────┐   │
│   │ MCP Interface│   │ ← Resources, Tools, Prompts
│   └──────────────┘   │
└──────────┬───────────┘
           │ MCP Protocol (stdio)
           ▼
┌──────────────────────┐
│    LLM Client        │
│  (Claude Desktop)    │
└──────────────────────┘
```

## Development

```bash
git clone https://github.com/Valyay/nanostores-mcp.git
cd nanostores-mcp
pnpm install

pnpm dev          # Run dev server
pnpm build        # TypeScript compile
pnpm test         # Run vitest
pnpm lint         # ESLint
pnpm check        # All checks: lint + format + test + build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector pnpm run dev
```

## Troubleshooting

**Logger not receiving events:**

1. Use the `ping` tool to verify logger bridge is enabled and running
2. Check browser console for `[nanostores-mcp]` warnings about connection issues
3. Confirm the port matches between server (`NANOSTORES_MCP_LOGGER_PORT`) and client URL
4. Test with a simple atom store to verify events flow

**Port conflicts:**

```bash
# Change server port
NANOSTORES_MCP_LOGGER_PORT=4000 npx nanostores-mcp

# Update client
initMcpLogger({ url: "http://127.0.0.1:4000/nanostores-logger" });
```

**TypeScript errors:**

```typescript
// Import from the mcpLogger subpath export
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";
```

**Documentation not found:**

- The server auto-detects docs from `nanostores` in your `node_modules`
- Make sure `nanostores` is installed: `npm install nanostores`
- Or set `NANOSTORES_DOCS_ROOT` to point at a docs directory manually

## Related Projects

- [nanostores](https://github.com/nanostores/nanostores) — Tiny state manager
- [@nanostores/logger](https://github.com/nanostores/logger) — Logger for nanostores
- [Model Context Protocol](https://modelcontextprotocol.io/) — MCP specification

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.

## Author

Built by [@Valyay](https://github.com/Valyay)
