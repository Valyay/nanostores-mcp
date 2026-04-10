# Nano Stores MCP

<img align="right" width="92" height="92" title="Nano Stores logo"
     src="https://nanostores.github.io/nanostores/logo.svg">

**Model Context Protocol server for Nanostores** — analyze, debug and monitor
your nanostores in AI assistants like Claude Desktop.

- **📊 Static Analysis:** AST-based project scanning, dependency graphs, store inspection
- **🔥 Runtime Monitoring:** Live events from `@nanostores/logger`, performance metrics, activity tracking
- **📚 Documentation:** Search and browse Nanostores docs by topic or store kind
- **🎯 Zero Config:** Works out of the box — auto-detects project roots and nanostores docs
- **🌐 Framework-Agnostic:** Works with React, Vue, Svelte, Angular, Solid, Preact, Lit — any framework that uses Nanostores

```bash
npx nanostores-mcp
```

Ask your AI: _"Analyze my store architecture"_ or _"Which stores update most frequently?"_

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
- [MCP Interface](#mcp-interface)
  - [Resources](#mcp-resources)
  - [Tools](#mcp-tools)
  - [Advanced Tool Arguments](#advanced-tool-arguments)
  - [Prompts](#mcp-prompts)
- [Runtime Monitoring](#runtime-monitoring)
  - [Reading Results](#reading-results)
  - [Privacy & Security](#privacy--security)
- [Example Queries](#example-queries)
- [Architecture](#architecture)
- [Limitations & Caveats](#limitations--caveats)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Features

### 📊 Static Analysis (AST-based)

Understand your nanostores architecture without running your app:

- **Project scanning** — find all stores, subscribers, and import/export relationships
- **Dependency graph** — visualize how stores depend on each other (Mermaid diagrams)
- **Store inspection** — type (atom/map/computed/batched/persistentAtom/persistentMap/router), location, usage patterns, related files
- **Framework-aware subscriber detection** — recognizes `.subscribe()` / `.listen()` calls and component bindings across React, Vue, Svelte, and Angular
- **Vue SFC support** — parses both `<script>` and `<script setup>` blocks in `.vue` files (requires `@vue/compiler-sfc`)
- **Svelte support** — parses `<script context="module">` and instance `<script>` blocks, auto-subscriptions (`$storeName` in templates), and filters out Svelte 5 runes (`$state`, `$derived`, `$effect`, etc.) so they are not mistaken for store references (requires `svelte`)
- **Angular DI support** — resolves `@nanostores/angular` `NanostoresService` constructor injections and detects `this.nanostores.useStore(...)` call patterns in TypeScript component files

### 🔥 Runtime Monitoring (Logger Integration)

Real-time insights into your running application:

- **Live event capture** — mount/unmount, value changes, action calls from `@nanostores/logger`
- **Performance analysis** — find noisy stores, high error rates, performance bottlenecks
- **Activity metrics** — change frequency, action success/failure rates, action duration
- **Combined analysis** — merge static structure with runtime behavior for deep debugging

### 📚 Documentation Search

Search and browse Nanostores documentation directly from your AI assistant:

- **Full-text search** — find guides, API references, and best practices by query
- **Store-kind lookup** — get docs relevant to a specific store type (atom, map, computed, etc.)
- **Auto-detection** — picks up docs from `nanostores` in your `node_modules` automatically

## Requirements

| Requirement | Version                 |
| ----------- | ----------------------- |
| Node.js     | `^20.0.0 \|\| >=22.0.0` |

**Required peer dependency** (for static analysis):

```bash
npm install nanostores
```

**Optional peer dependencies** — install only if you use the corresponding file format:

| Package              | When needed                            |
| -------------------- | -------------------------------------- |
| `@vue/compiler-sfc`  | Vue SFC (`.vue`) file scanning         |
| `svelte`             | Svelte (`.svelte`) file scanning       |
| `@nanostores/logger` | Runtime monitoring (`attachMcpLogger`) |

Without these optional packages the server still works — it silently skips unsupported file types.

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

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
	"mcpServers": {
		"nanostores": {
			"command": "npx",
			"args": ["-y", "nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project"
			}
		}
	}
}
```

### VS Code

Requires **GitHub Copilot** extension (VS Code 1.99+). Create `.vscode/mcp.json` in your project:

```json
{
	"servers": {
		"nanostores": {
			"type": "stdio",
			"command": "npx",
			"args": ["-y", "nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "${workspaceFolder}"
			}
		}
	}
}
```

Tools are available in Copilot's **Agent mode** (select "Agent" in the Copilot Chat dropdown).

### Cursor

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global):

```json
{
	"mcpServers": {
		"nanostores": {
			"command": "npx",
			"args": ["-y", "nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project"
			}
		}
	}
}
```

### Zed

Add to your Zed `settings.json`:

```json
{
	"context_servers": {
		"nanostores": {
			"command": "npx",
			"args": ["-y", "nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project"
			}
		}
	}
}
```

The server appears in Zed's **Agent Panel** settings.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
	"mcpServers": {
		"nanostores": {
			"command": "npx",
			"args": ["-y", "nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project"
			}
		}
	}
}
```

You can also open this file from the MCP icon in the Cascade panel → "Configure".

### Claude Code

Add via CLI:

```bash
claude mcp add --transport stdio nanostores -- npx -y nanostores-mcp
```

Or create `.mcp.json` in your project root (shared with the team):

```json
{
	"mcpServers": {
		"nanostores": {
			"command": "npx",
			"args": ["-y", "nanostores-mcp"],
			"env": {
				"NANOSTORES_MCP_ROOT": "/path/to/your/project"
			}
		}
	}
}
```

### Environment Variables

| Variable                        | Default     | Description                                                                     |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `NANOSTORES_MCP_ROOT`           | cwd         | Project root path                                                               |
| `NANOSTORES_MCP_ROOTS`          | —           | Platform-delimited roots (`:` on Unix, `;` on Windows) for multi-project setup  |
| `WORKSPACE_FOLDER`              | —           | Alias for `NANOSTORES_MCP_ROOT` — set automatically by VS Code and some editors |
| `WORKSPACE_FOLDER_PATHS`        | —           | Alias for `NANOSTORES_MCP_ROOTS` — set automatically by some editors            |
| `NANOSTORES_MCP_LOGGER_ENABLED` | `false`     | Enable runtime event collection                                                 |
| `NANOSTORES_MCP_LOGGER_PORT`    | `3999`      | HTTP port for logger bridge                                                     |
| `NANOSTORES_MCP_LOGGER_HOST`    | `127.0.0.1` | Host to bind. Allowed values: `127.0.0.1`, `localhost`, `::1`                   |
| `NANOSTORES_DOCS_ROOT`          | auto-detect | Path to documentation directory                                                 |
| `NANOSTORES_DOCS_PATTERNS`      | `**/*.md`   | Comma-separated glob patterns for docs                                          |

### How the Project Root Is Resolved

The server picks workspace roots in priority order:

1. **Environment variables** (highest priority) — `NANOSTORES_MCP_ROOTS` / `NANOSTORES_MCP_ROOT` / `WORKSPACE_FOLDER_PATHS` / `WORKSPACE_FOLDER`
2. **Client roots** — roots reported by the MCP client via the `roots/list` capability (set automatically by some editors)
3. **Current working directory** — `process.cwd()` used as fallback when neither env nor client roots are configured

When a tool is called without an explicit `projectRoot` argument the server uses the **first configured root**. In a multi-root setup always pass `projectRoot` to avoid ambiguity.

## Quick Start

### 1. Static Analysis

Works out of the box — just point at your project and ask:

- _"Analyze my store architecture"_
- _"Explain how nanostores is used in this project"_
- _"Give me a summary of the $cart store"_
- _"My stores changed — re-scan the project"_ ← the AI will force a fresh scan

### 2. Documentation Search

Auto-detected from `nanostores` in your `node_modules`:

- _"How do I use computed stores?"_
- _"Show me the docs for persistentAtom"_

### 3. Runtime Monitoring (Optional)

Requires logger integration in your app. See [Runtime Monitoring](#runtime-monitoring) below.

- _"Which stores update most frequently?"_
- _"Show me recent activity for $user"_
- _"Give me an overall health report"_

### Verify Your Setup

Run these four tools in order to confirm everything is working:

```
nanostores_ping              → should return server status and logger bridge state
nanostores_scan_project      → should list your stores and subscribers
nanostores_docs_search       → should return documentation results (requires nanostores in node_modules)
nanostores_runtime_overview  → should return overview (or "no runtime data" if logger is disabled — that's fine)
```

If `nanostores_scan_project` returns zero stores, check that `NANOSTORES_MCP_ROOT` points to the correct project directory.

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

| Tool                         | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `nanostores_scan_project`    | Scan project for all stores, subscribers, and dependencies        |
| `nanostores_store_summary`   | Detailed summary of a specific store                              |
| `nanostores_project_outline` | High-level overview: store kinds, top directories, hub stores     |
| `nanostores_store_subgraph`  | BFS-expanded dependency neighborhood of a store                   |
| `nanostores_store_impact`    | Downstream causal chain — what recomputes/re-renders if X changes |

**Runtime Monitoring**

| Tool                           | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `nanostores_runtime_overview`  | Overall health report with statistics for all stores               |
| `nanostores_store_activity`    | Activity timeline for a specific store (filterable by kind/action) |
| `nanostores_find_noisy_stores` | Identify stores with high change frequency or error rates          |
| `nanostores_runtime_coverage`  | Compare static graph with runtime events to find coverage gaps     |

**Documentation**

| Tool                     | Description                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `nanostores_docs_search` | Search docs by `query` (full-text), `storeKind` (atom, map, computed, persistentAtom, etc.), or both. Optional: `limit` (default 10), `tags` |

Use `nanostores://docs/page/{id}` resource to read the full content of pages returned by search.

**Utilities**

| Tool                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `nanostores_ping`        | Server health check and logger bridge status |
| `nanostores_clear_cache` | Clear project index cache to force rescan    |

### MCP Prompts

| Prompt                   | Parameters                | Description                                                                                                               |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `explain-project`        | `focus` _(optional)_      | AI-guided explanation of your project's store architecture. `focus` narrows to a feature/domain (e.g. `"cart"`, `"auth"`) |
| `explain-store`          | `store_name` _(required)_ | Deep dive into a specific store's implementation and usage                                                                |
| `debug-store`            | `store_name` _(required)_ | Comprehensive analysis combining static + runtime data                                                                    |
| `debug-project-activity` | —                         | Project-wide performance analysis and optimization                                                                        |
| `docs-how-to`            | `task` _(required)_       | Step-by-step guidance for a Nanostores task, backed by docs (e.g. `"How do I sync a map store to localStorage?"`)         |

### Advanced Tool Arguments

Most tools accept these optional arguments that significantly change their behavior:

| Argument      | Type                         | Used in                                                   | Description                                                                                                                                                                                    |
| ------------- | ---------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storeId`     | `string`                     | `store_summary`, `store_subgraph`, `store_impact`         | Exact store identifier — format: `store:src/stores.ts#$counterName`. Takes priority over `name` when both are provided.                                                                        |
| `name`        | `string`                     | `store_summary`, `store_subgraph`, `store_impact`         | Store name (e.g. `"$user"`). Used when `storeId` is not provided.                                                                                                                              |
| `radius`      | `number` (0–10, default `2`) | `nanostores_store_subgraph`                               | BFS hops around the store. `1` = direct deps only; `2` = deps of deps. **Warning:** on highly-connected hub stores (hub score > 5) radius ≥ 2 may return most of the project — start with `1`. |
| `projectRoot` | `string`                     | most tools                                                | Which project root to analyze in multi-root setups. Omit to use the first configured root. Always specify this in multi-root projects.                                                         |
| `windowMs`    | `number`                     | `store_activity`, `find_noisy_stores`, `runtime_overview` | Look-back window in milliseconds (e.g. `60000` = last 60 s). Filters events to that time range.                                                                                                |
| `kinds`       | `string[]`                   | `nanostores_store_activity`                               | Filter events by type. Values: `"mount"`, `"unmount"`, `"change"`, `"action-start"`, `"action-end"`, `"action-error"`.                                                                         |
| `actionName`  | `string`                     | `nanostores_store_activity`                               | Filter events to a specific action (e.g. `"increment"`).                                                                                                                                       |
| `compact`     | `boolean`                    | `scan_project`, `find_noisy_stores`, `runtime_overview`   | Return a compressed token-efficient table instead of full text. Useful for large projects to reduce context usage.                                                                             |

## Runtime Monitoring

For runtime analysis, integrate the MCP Logger client into your application.

**1. Install in your app and enable the logger bridge:**

```bash
npm install nanostores-mcp
```

Add `NANOSTORES_MCP_LOGGER_ENABLED` to your MCP server config (see [Configuration](#configuration) for your editor's format):

```json
"env": {
	"NANOSTORES_MCP_ROOT": "/path/to/your/project",
	"NANOSTORES_MCP_LOGGER_ENABLED": "true"
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
attachMcpLogger($count, "$count");
attachMcpLogger($user, "$user");
attachMcpLogger($greeting, "$greeting");
```

**3. Use stores normally** — events (mount, unmount, change, actions) are captured automatically and batched to the MCP server every second.

**4. Ask your AI assistant:**

- _"Which stores change most frequently?"_ → `nanostores_find_noisy_stores`
- _"Show me recent activity for $user"_ → `nanostores_store_activity`
- _"Give me an overall health report"_ → `nanostores_runtime_overview`

### Logger Options

```typescript
initMcpLogger({
	url: "http://127.0.0.1:3999/nanostores-logger", // default; change if using a custom port
	batchMs: 1000, // default; lower for faster delivery (e.g. 200)
	projectRoot: "/absolute/path/to/project", // link runtime events with static analysis

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

window.addEventListener("beforeunload", async () => {
	await getMcpLogger()?.forceFlush();
});
```

### Reading Results

**`nanostores_runtime_overview` health summary**

The overview groups stores into three categories:

- **Top active stores** — sorted by total event count (changes + actions). A store that appears here with hundreds of changes in seconds may be a performance concern.
- **Error-prone stores** — stores with `action-error` events. High error counts indicate failing async actions.
- **Unmounted stores** — stores seen at mount but never unmounted. May indicate memory leaks.

**`nanostores_runtime_coverage`**

Compares your static store graph against observed runtime events:

| Term                 | Meaning                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **static-only**      | Store found by AST scan but **no runtime events** observed. Possible dead code, deferred initialization, or missing `attachMcpLogger` call.             |
| **runtime-only**     | Events received for a store **not found by the scanner**. Common for dynamically-created stores, factory patterns, or stores in `node_modules`.         |
| **Coverage by kind** | E.g. `atom: 3/5 (60%)` — 3 out of 5 atom stores received runtime events. 0% for a kind usually means `attachMcpLogger` was not called for those stores. |

**`nanostores_find_noisy_stores`**

Returns stores ranked by total activity (changes + actions combined) within the `windowMs` period. A store is considered "noisy" when its change frequency is disproportionately high relative to visible UI updates — use this to find re-render hotspots or thrashing computed chains.

### Privacy & Security

The runtime logger is designed to stay on your local machine:

- **Loopback-only binding** — the HTTP bridge accepts connections exclusively from `127.0.0.1`, `localhost`, or `::1`. Binding to `0.0.0.0` is explicitly blocked. Data never leaves your machine.
- **What is transmitted** — from your app to the MCP server over localhost: store name, timestamp, event kind, and optionally value snapshots (truncated to 200 characters). Nothing is sent to Anthropic or any third party.
- **Nothing is persisted** — events are held in a ring buffer (5 000 events max) in process memory and discarded when the server restarts.
- **Mask sensitive data** — use `maskEvent` to filter or redact events client-side before they are batched and sent:

```typescript
initMcpLogger({
	maskEvent: event => {
		if (event.storeName === "$authToken") return null; // drop entirely
		if (event.storeName === "$paymentInfo") return { ...event, newValue: undefined }; // strip value
		return event;
	},
});
```

- **CORS** — the bridge rejects cross-origin requests from non-loopback origins.

## Example Queries

Ask your AI assistant natural language questions:

**Static Analysis:**

- _"Analyze my store architecture for potential issues"_
- _"What happens when $user changes? Show subscribers and derived stores"_

**Runtime Debugging:**

- _"Which stores update most frequently?"_
- _"Are there stores declared in code but never used at runtime?"_
- _"Debug the $user store — combine static analysis with runtime behavior"_

**With [Playwright MCP](https://github.com/microsoft/playwright-mcp):**

- _"Open my app in the browser, interact with it, and analyze which stores cause the most recalculations"_

**Documentation:**

- _"How do I use computed stores?"_
- _"Show me best practices for persistent stores"_

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
│ (Claude, VS Code, …) │
└──────────────────────┘
```

## Limitations & Caveats

**Multi-root: same store name in multiple projects**

In multi-root mode a store named `$user` can exist in two different projects. The runtime event store uses a composite key (`projectRoot + storeName`) to keep them separate, but summary views may show the same name twice with no project label. Always specify `projectRoot` when querying tools in a multi-root setup to get unambiguous results.

**Static analysis only covers discovered files**

The AST scanner follows TypeScript/JavaScript imports from your project root. Stores created dynamically at runtime, generated by factories, or living in `node_modules` will not appear in static results — they may show up as "runtime-only" in coverage reports.

**Vue and Svelte parsing requires optional dependencies**

If `@vue/compiler-sfc` or `svelte` are not installed, `.vue` / `.svelte` files are silently skipped during scanning. Install them as dev dependencies if you want full coverage for those file types.

**Event ring buffer is capped at 5 000 events**

Older events are dropped when the buffer is full. For high-frequency stores use `windowMs` to narrow your queries to recent data, or lower `batchMs` in `initMcpLogger` to deliver events more frequently and reduce the chance of buffer overflow during bursts.

**`radius` on hub stores can be very large**

Stores with many dependencies (hub score > 5) can return most of the project graph at `radius=2`. Start with `radius=1` and increase only if you need broader context.

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

**Nanostores ecosystem:**

- [nanostores](https://github.com/nanostores/nanostores) — Tiny state manager (atom, map, computed, batched, deepMap)
- [@nanostores/logger](https://github.com/nanostores/logger) — Logger and action system
- [@nanostores/persistent](https://github.com/nanostores/persistent) — Persistent stores (localStorage, sessionStorage)
- [@nanostores/router](https://github.com/nanostores/router) — SPA router
- [@nanostores/i18n](https://github.com/nanostores/i18n) — Internationalization
- [@nanostores/react](https://github.com/nanostores/react), [@nanostores/vue](https://github.com/nanostores/vue), [@nanostores/preact](https://github.com/nanostores/preact), [@nanostores/solid](https://github.com/nanostores/solid), [@nanostores/lit](https://github.com/nanostores/lit) — Framework bindings

**MCP:**

- [Model Context Protocol](https://modelcontextprotocol.io/) — MCP specification
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — Browser automation (works with nanostores-mcp for runtime analysis)

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.

## Author

Built by [@Valyay](https://github.com/Valyay)
