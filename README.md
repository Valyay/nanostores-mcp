# Nano Stores MCP

<img align="right" width="92" height="92" title="Nano Stores logo"
     src="https://nanostores.github.io/nanostores/logo.svg">

**Model Context Protocol server for Nanostores** - analyze, debug and monitor
your nanostores in AI assistants like Claude Desktop.

- **📊 Static Analysis:** AST-based project scanning, dependency graphs, store inspection
- **🔥 Runtime Monitoring:** Live events from `@nanostores/logger`, performance metrics, activity tracking
- **🤖 AI-Powered Debugging:** Natural language queries about your stores via MCP prompts and tools
- **🎯 Zero Config:** Works out of the box for static analysis, optional logger integration for runtime insights

```bash
pnpm install -g nanostores-mcp
```

Ask your AI: _"Show me the dependency graph"_ or _"Which stores are causing the most re-renders?"_

---

<img src="https://cdn.evilmartians.com/badges/logo-no-label.svg" alt="" width="22" height="16" /> Made by <b><a href="https://github.com/Valyay">@Valyay</a></b>

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
  - [Static Analysis](#1-static-analysis)
  - [Runtime Monitoring](#2-runtime-monitoring-optional)
- [MCP Interface](#mcp-interface)
  - [Resources](#mcp-resources)
  - [Tools](#mcp-tools)
  - [Prompts](#mcp-prompts)
- [Example Queries](#example-queries)
- [Architecture](#architecture)
- [Development](#development)
- [Related Projects](#related-projects)

## Features

### 📊 Static Analysis (AST-based)

Understand your nanostores architecture without running your app:

- **Project scanning** - Find all stores, subscribers, and import/export relationships
- **Dependency graph** - Visualize how stores depend on each other (Mermaid diagrams)
- **Store inspection** - Type (atom/map/computed), location, usage patterns, related files
- **Documentation extraction** - JSDoc comments and inline documentation

### 🔥 Runtime Monitoring (Logger Integration)

Real-time insights into your running application:

- **Live event capture** - Mount/unmount, value changes, action calls from `@nanostores/logger`
- **Performance analysis** - Find noisy stores, high error rates, performance bottlenecks
- **Activity metrics** - Change frequency, action success/failure rates, mount duration
- **Dead code detection** - Identify stores that were never mounted or used
- **Combined analysis** - Merge static structure with runtime behavior for deep debugging

### 🤖 AI-Powered Debugging

Natural language interface for debugging via MCP:

- Ask questions about your stores in plain English
- Get recommendations for optimizations
- Understand complex store relationships
- Debug performance issues with context-aware suggestions

## Installation

### Global Installation

```bash
npm install -g nanostores-mcp
# or
pnpm add -g nanostores-mcp
# or
yarn global add nanostores-mcp
```

### Use via npx (no installation)

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
				"NANOSTORES_MCP_ROOT": "/path/to/your/project",
				"NANOSTORES_MCP_LOGGER_ENABLED": "true"
			}
		}
	}
}
```

### Environment Variables

**Project Configuration:**

- `NANOSTORES_MCP_ROOT` - Project root path (default: current directory)
- `NANOSTORES_MCP_ROOTS` - Comma-separated list of roots for multi-project setup

**Logger Bridge (optional):**

- `NANOSTORES_MCP_LOGGER_ENABLED` - Enable runtime event collection (default: `false`)
- `NANOSTORES_MCP_LOGGER_PORT` - HTTP port for logger bridge (default: `3999`)
- `NANOSTORES_MCP_LOGGER_HOST` - Host to bind (default: `127.0.0.1`)

**Documentation (optional):**

- `NANOSTORES_DOCS_ROOT` - Path to documentation directory
- `NANOSTORES_DOCS_PATTERNS` - Comma-separated glob patterns for docs (default: `**/*.md`)

## Quick Start

### 1. Static Analysis

Use without any additional setup:

```bash
# In Claude or MCP Inspector
Call tool: scan_project
Call tool: store_summary

# View resources
nanostores://graph
nanostores://store/$counter
```

### 2. Runtime Monitoring (Optional)

For runtime analysis, use the included MCP Logger client to capture live events from your nanostores.

**Install the package:**

```bash
npm install nanostores-mcp
# or
pnpm add nanostores-mcp
```

**Basic integration:**

In your app entry point (e.g., `main.tsx`, `App.tsx`):

```typescript
import { atom, map } from "nanostores";
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";

// Your stores
const $counter = atom(0);
const $user = map({ name: "Alice", role: "admin" });

// Initialize logger (automatically disabled in production)
initMcpLogger();

// Attach to stores you want to monitor
attachMcpLogger($counter, "counter");
attachMcpLogger($user, "user");
```

**Configuration options:**

```typescript
initMcpLogger({
	// Custom server URL (default: http://127.0.0.1:3999/nanostores-logger)
	url: "http://localhost:4000/nanostores-logger",

	// Batch interval in ms (default: 1000)
	batchMs: 500,

	// Project root for linking runtime with static analysis
	projectRoot: "/absolute/path/to/your/project",

	// Mask sensitive data
	maskEvent: event => {
		if (event.storeName === "authToken") return null;
		if (event.kind === "change" && event.valueMessage?.length > 100) {
			return { ...event, valueMessage: event.valueMessage.slice(0, 100) + "..." };
		}
		return event;
	},
});
```

**What you get:**

- 🔴 **Live event stream** - Mount, unmount, changes, and action calls
- 📊 **Statistics** - Change frequency, action success/failure rates
- 🎯 **Performance insights** - Find noisy stores, error-prone actions
- 🔍 **Combined analysis** - Runtime behavior + static code structure

For complete integration guide with framework-specific examples, see [docs/LOGGER_INTEGRATION.md](./docs/LOGGER_INTEGRATION.md).

## Usage Tips

**Enable logger bridge in MCP server:**

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

**Check server status:**

Ask Claude: _"Ping the nanostores server"_ or use the `ping` tool to verify the logger bridge is running.

**Auto-attach pattern:**

Create factory functions to automatically instrument all stores:

```typescript
import { atom, map } from "nanostores";
import { attachMcpLogger } from "nanostores-mcp/mcpLogger";

export function createAtom<T>(name: string, initial: T) {
	const store = atom(initial);
	attachMcpLogger(store, name);
	return store;
}

// Usage
export const $counter = createAtom("counter", 0);
```

## MCP Interface

### MCP Resources

**Static Analysis**

- `nanostores://graph` - Full dependency graph (text format)
- `nanostores://graph/mermaid` - Dependency graph as Mermaid diagram
- `nanostores://store/{key}` - Store details (by name or id)

**Runtime Monitoring**

- `nanostores://runtime/events` - Recent logger events stream
- `nanostores://runtime/stats` - Aggregated statistics across all stores
- `nanostores://runtime/store/{key}` - Combined runtime + static analysis for specific store

**Documentation** (if `NANOSTORES_DOCS_ROOT` configured)

- `nanostores://docs/index` - Documentation index with all pages and tags
- `nanostores://docs/page/{pageId}` - Full content of documentation page
- `nanostores://docs/search?q={query}` - Search results for documentation query

### MCP Tools

**Static Analysis**

- `scan_project` - Scan project for all nanostores, subscribers, and dependencies
- `store_summary` - Get detailed summary of stores in a specific file

**Runtime Monitoring**

- `nanostores_runtime_overview` - Overall health report with statistics for all stores
- `nanostores_store_activity` - Activity timeline and events for a specific store
- `nanostores_find_noisy_stores` - Identify stores with high change frequency or error rates

**Documentation** (if configured)

- `nanostores_docs_search` - Search nanostores documentation by keyword
- `nanostores_docs_for_store` - Find relevant documentation for a specific store type

**Utilities**

- `ping` - Server health check and logger bridge status

### MCP Prompts

**Static Analysis**

- `nanostores/explain-project` - AI-guided explanation of your project's store architecture
- `nanostores/explain-store` - Deep dive into a specific store's implementation and usage

**Runtime Debugging**

- `nanostores/debug-store` - Comprehensive analysis combining static + runtime data with recommendations
- `nanostores/debug-project-activity` - Project-wide performance analysis and optimization suggestions

**Documentation** (if configured)

- `nanostores/docs-how-to` - Interactive help for nanostores concepts and patterns

## Example Queries

Ask your AI assistant natural language questions:

**Static Analysis:**

- _"Show me the dependency graph for my nanostores"_
- _"Explain what the $cart store does"_
- _"Which stores depend on $user?"_
- _"List all stores in my project"_
- _"Show me the implementation of $counter"_

**Runtime Debugging:**

- _"Which stores are causing the most re-renders?"_
- _"Debug the $user store with both static and runtime data"_
- _"Are there any unused stores in my project?"_
- _"Show me recent activity for $cart"_
- _"Which stores have the highest error rates?"_
- _"Find performance bottlenecks in my stores"_

**Documentation (if configured):**

- _"How do I use computed stores?"_
- _"Show me documentation about persistent stores"_
- _"What's the best way to structure actions?"_

**Behind the scenes:**

- Graph queries → `nanostores://graph` resource
- Store explanations → `nanostores/explain-store` prompt
- Performance analysis → `nanostores_find_noisy_stores` tool
- Debugging → `nanostores/debug-store` prompt
- Documentation → `nanostores_docs_search` tool

## Architecture

```
┌──────────────────────┐
│   Your Application   │
│                      │
│  @nanostores/logger  │
│        events        │
└──────────┬───────────┘
           │ HTTP POST
           ▼
┌──────────────────────┐
│   nanostores-mcp     │
│   ┌──────────────┐   │
│   │ Logger Bridge│   │ ← HTTP server (localhost:3999)
│   └──────┬───────┘   │
│          ▼           │
│   ┌──────────────┐   │
│   │ Event Store  │   │ ← Ring buffer + stats
│   └──────┬───────┘   │
│          │           │
│   ┌──────┴───────┐   │
│   │  AST Scanner │   │ ← Static analysis
│   └──────┬───────┘   │
│          │           │
│   ┌──────┴───────┐   │
│   │ MCP Interface│   │ ← Resources, Tools, Prompts
│   └──────────────┘   │
└──────────┬───────────┘
           │ MCP Protocol
           ▼
┌──────────────────────┐
│    LLM Client        │
│  (Claude Desktop)    │
└──────────────────────┘
```

## Troubleshooting

**Logger not receiving events:**

1. Check server status: Use `ping` tool to verify logger bridge is enabled
2. Verify client is initialized: Check browser console for initialization messages
3. Confirm URL matches: Client URL should match `NANOSTORES_MCP_LOGGER_PORT`
4. Test with simple store: Create a test atom and verify it mounts

**Port conflicts:**

```bash
# Change server port
NANOSTORES_MCP_LOGGER_PORT=4000 npx nanostores-mcp

# Update client
initMcpLogger({ url: "http://127.0.0.1:4000/nanostores-logger" });
```

**TypeScript errors:**

Make sure you're importing from the correct path:

```typescript
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";
```

For more troubleshooting help, see [docs/LOGGER_INTEGRATION.md](./docs/LOGGER_INTEGRATION.md#troubleshooting).

## Development

```bash
# Clone
git clone https://github.com/Valyay/nanostores-mcp.git
cd nanostores-mcp

# Install dependencies
pnpm install

# Build
pnpm build

# Run in dev mode
pnpm dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector pnpm run dev
```

## Related Projects

- [nanostores](https://github.com/nanostores/nanostores) - Tiny state manager
- [@nanostores/logger](https://github.com/nanostores/logger) - Logger for nanostores
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.

## Author

Built by [@Valyay](https://github.com/Valyay)
