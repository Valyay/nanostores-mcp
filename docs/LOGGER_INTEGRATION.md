# @nanostores/logger Integration

This document describes the runtime logger integration for `nanostores-mcp`.

## Overview

The logger integration provides **runtime visibility** into your nanostores by capturing events from `@nanostores/logger` and making them available through MCP resources, tools, and prompts.

**Key features:**

- Real-time event capture (mount, unmount, changes, actions)
- Aggregated statistics per store
- Performance analysis (noisy stores, error rates)
- Dead code detection (unused stores)
- Runtime + static analysis for comprehensive debugging

## Architecture

```
┌─────────────────┐                    ┌──────────────────┐
│   Your App      │  HTTP POST         │  nanostores-mcp  │
│   (Browser/Node)│  ────────────────► │  Logger Bridge   │
│                 │                    │  (localhost:3999)│
│ @nanostores/    │                    │                  │
│ logger events   │                    │  Event Store     │
└─────────────────┘                    │  (ring buffer)   │
                                       │                  │
                                       │  MCP Interface   │
                                       └──────────────────┘
                                              │
                                              ▼
                                       ┌──────────────┐
                                       │  LLM Client  │
                                       │  (Claude)    │
                                       └──────────────┘
```

## Server Configuration

The logger bridge is configured via environment variables:

```bash
# Enable/disable logger bridge (default: false)
NANOSTORES_MCP_LOGGER_ENABLED=true

# Port for HTTP endpoint (default: 3999)
NANOSTORES_MCP_LOGGER_PORT=3999

# Host to bind to (default: 127.0.0.1, SECURITY: never use 0.0.0.0)
NANOSTORES_MCP_LOGGER_HOST=127.0.0.1
```

**Security note:** The bridge only listens on `localhost` by default. Never expose this to the network.

## Client Integration

The `nanostores-mcp` package includes a ready-to-use client for runtime monitoring. No manual implementation needed!

### Installation

```bash
npm install nanostores-mcp
# or
pnpm add nanostores-mcp
# or
yarn add nanostores-mcp
```

### Basic Usage

In your app entry point (e.g., `main.tsx`, `App.tsx`):

```typescript
import { atom, map } from "nanostores";
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";

// Your stores
export const $counter = atom(0);
export const $user = map({ name: "Alice", role: "admin" });

// Initialize MCP Logger (automatically disabled in production)
initMcpLogger();

// Attach logger to stores you want to monitor
attachMcpLogger($counter, "counter");
attachMcpLogger($user, "user");
```

**That's it!** The logger is now active and sending events to the MCP server.

### Configuration Options

```typescript
import { initMcpLogger } from "nanostores-mcp/mcpLogger";

initMcpLogger({
	// Custom server URL (default: http://127.0.0.1:3999/nanostores-logger)
	url: "http://localhost:4000/nanostores-logger",

	// Batch interval in milliseconds (default: 1000)
	batchMs: 500,

	// Project root path - links runtime events with static analysis
	projectRoot: "/absolute/path/to/your/project",

	// Explicitly enable/disable (default: auto-detect dev mode)
	enabled: import.meta.env.DEV,

	// Mask or filter events before sending
	maskEvent: event => {
		// Hide sensitive stores
		if (event.storeName === "authToken") return null;

		// Truncate large values
		if (event.kind === "change" && event.valueMessage?.length > 100) {
			return { ...event, valueMessage: event.valueMessage.slice(0, 100) + "..." };
		}

		return event;
	},
});
```

### Manual Flush (Optional)

For critical scenarios like app shutdown:

```typescript
import { getMcpLogger } from "nanostores-mcp/mcpLogger";

window.addEventListener("beforeunload", async () => {
	const logger = getMcpLogger();
	await logger?.forceFlush();
});
```

### Auto-attach Pattern (Optional)

Create store factory functions to automatically attach the logger:

```typescript
// stores/factories.ts
import { atom, map, computed } from "nanostores";
import { attachMcpLogger } from "nanostores-mcp/mcpLogger";
import type { MapStore, WritableAtom } from "nanostores";

export function createMonitoredAtom<T>(name: string, initial: T): WritableAtom<T> {
	const store = atom(initial);
	attachMcpLogger(store, name);
	return store;
}

export function createMonitoredMap<T extends Record<string, any>>(name: string): MapStore<T> {
	const store = map<T>();
	attachMcpLogger(store, name);
	return store;
}

// Usage in your stores:
export const $counter = createMonitoredAtom("counter", 0);
export const $user = createMonitoredMap("user");
```

### Framework-Specific Examples

**React/Preact:**

```typescript
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";
import { $counter, $user } from "./stores";
import App from "./App";

if (import.meta.env.DEV) {
	initMcpLogger();
	attachMcpLogger($counter, "counter");
	attachMcpLogger($user, "user");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
```

**Vue:**

```typescript
// src/main.ts
import { createApp } from "vue";
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";
import { $counter, $user } from "./stores";
import App from "./App.vue";

if (import.meta.env.DEV) {
	initMcpLogger();
	attachMcpLogger($counter, "counter");
	attachMcpLogger($user, "user");
}

createApp(App).mount("#app");
```

**Svelte:**

```typescript
// src/main.ts
import { initMcpLogger, attachMcpLogger } from "nanostores-mcp/mcpLogger";
import { counter, user } from "./stores";
import App from "./App.svelte";

if (import.meta.env.DEV) {
	initMcpLogger();
	attachMcpLogger(counter, "counter");
	attachMcpLogger(user, "user");
}

const app = new App({ target: document.getElementById("app")! });
export default app;
```

## MCP Resources

Once events are flowing, you can access runtime data via:

### `nanostores://runtime/events`

Recent logger events with filtering:

- Query params: `storeName`, `kind`, `since`, `limit`, `actionName`

### `nanostores://runtime/stats`

Aggregated statistics for all stores:

- Top noisy stores
- Error-prone stores
- Overall activity metrics

### `nanostores://runtime/store/{key}`

Runtime profile for a specific store:

- Statistics (mounts, changes, actions, errors)
- Recent events
- Activity analysis

## MCP Tools

### `nanostores_store_activity`

Get detailed runtime activity for a store:

```json
{
	"storeName": "counter",
	"limit": 50,
	"windowMs": 60000
}
```

### `nanostores_find_noisy_stores`

Find stores with highest activity:

```json
{
	"limit": 5,
	"windowMs": 300000
}
```

### `nanostores_runtime_overview`

Overall health report:

- Active stores
- Error-prone stores
- Unused stores (never mounted)
- Activity patterns

## MCP Prompts

### `nanostores/debug-store`

Deep analysis of a specific store combining:

- Static structure (AST)
- Runtime behavior (events)
- Anti-pattern detection
- Refactoring suggestions

### `nanostores/debug-project-activity`

Project-wide runtime analysis:

- Identify hotspots
- Error patterns
- Dead code
- Optimization roadmap

## Example Workflow

1. **Start your MCP server with logger enabled:**

   ```bash
   NANOSTORES_MCP_LOGGER_ENABLED=true npm run dev
   ```

2. **Run your app in dev mode** (with logger integration)

3. **Check server status:**

   ```bash
   # In MCP Inspector or Claude
   Call tool: ping

   # Response includes logger bridge URL
   ```

4. **Get runtime overview:**

   ```bash
   Call tool: nanostores_runtime_overview

   # See which stores are active, noisy, or erroring
   ```

5. **Debug a specific store:**

   ```bash
   Use prompt: nanostores/debug-store
   With store_name: "cart"

   # Get comprehensive analysis with recommendations
   ```

## Troubleshooting

### No events received

1. Check logger bridge is enabled:

   ```bash
   Call tool: ping
   # Should show "Logger Bridge: enabled" or "running"
   ```

2. Verify client is initialized:

   ```typescript
   import { initMcpLogger } from "nanostores-mcp/mcpLogger";

   initMcpLogger({
   	url: "http://127.0.0.1:3999/nanostores-logger",
   	enabled: true, // Force enable for testing
   });
   ```

3. Check browser/Node console for:
   - Network errors (CORS, connection refused)
   - MCP Logger client initialization

4. Verify stores are being mounted (interact with your app to trigger events)

5. Check if stores are actually attached:

   ```typescript
   import { attachMcpLogger } from "nanostores-mcp/mcpLogger";
   import { $counter } from "./stores";

   const unbind = attachMcpLogger($counter, "counter");
   console.log("Logger attached:", typeof unbind === "function");
   ```

### Port already in use

Change the server port:

```bash
NANOSTORES_MCP_LOGGER_PORT=4000 npx nanostores-mcp
```

And update client:

```typescript
import { initMcpLogger } from "nanostores-mcp/mcpLogger";

initMcpLogger({
	url: "http://127.0.0.1:4000/nanostores-logger",
});
```

### Events truncated

Increase buffer size (server side):

```typescript
// In server.ts
const loggerEventStore = new LoggerEventStore(10000); // default: 5000
```

## Performance Considerations

- **Dev only**: Automatically disabled in production (checks `import.meta.env.DEV` and `NODE_ENV`)
- **Batching**: Client batches events every 1000ms (configurable) to reduce HTTP overhead
- **Buffer size**: Server uses ring buffer (default 5000 events) - oldest events are dropped when full
- **Async**: Event sending is non-blocking and won't impact app performance
- **Error handling**: Failed sends are silent - won't crash your app or show errors to users
- **Value truncation**: Large values are automatically truncated to 200 characters
- **Memory efficient**: Minimal overhead, suitable for development with many stores

## Security

- **Localhost only**: Bridge listens on `127.0.0.1` by default
- **No authentication**: Assumes local development environment
- **Payload limits**: 1MB max request size
- **Data masking**: Consider truncating large values in client before sending

## TypeScript Support

The package includes full TypeScript definitions:

```typescript
import type { McpLoggerClientOptions } from "nanostores-mcp/mcpLogger";

const options: McpLoggerClientOptions = {
	url: "http://127.0.0.1:3999/nanostores-logger",
	batchMs: 1000,
	enabled: true,
	projectRoot: "/path/to/project",
	maskEvent: event => {
		// Full type inference for events
		return event;
	},
};
```

## API Reference

### `initMcpLogger(options?)`

Initializes the global MCP Logger client. Must be called before `attachMcpLogger()`.

**Options:**

- `url?: string` - Server endpoint (default: `http://127.0.0.1:3999/nanostores-logger`)
- `batchMs?: number` - Batching interval in milliseconds (default: 1000)
- `enabled?: boolean` - Force enable/disable (default: auto-detect dev mode)
- `projectRoot?: string` - Absolute path to project root for linking with static analysis
- `maskEvent?: (event) => event | null` - Filter or transform events before sending

### `attachMcpLogger(store, storeName)`

Attaches the logger to a specific store.

**Parameters:**

- `store: AnyStore` - Any nanostores store (atom, map, computed, etc.)
- `storeName: string` - Unique identifier for the store

**Returns:** `() => void` - Cleanup function to detach the logger

### `getMcpLogger()`

Returns the global logger client instance for manual control.

**Returns:** `McpLoggerClient | null`

**Methods:**

- `forceFlush(): Promise<void>` - Immediately send all buffered events

## Future Enhancements

Potential additions:

- WebSocket transport for real-time streaming
- IPC transport for Node.js/Electron apps
- Built-in value masking helpers for common sensitive data patterns
- Event replay functionality
- Export events to JSON/CSV for offline analysis
- Integration with browser DevTools
