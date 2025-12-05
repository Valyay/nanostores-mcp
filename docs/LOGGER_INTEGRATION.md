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

To send events from your application to the MCP server, you need to:

1. **Install dependencies:**

   ```bash
   npm install -D @nanostores/logger
   ```

2. **Create a transport helper:**

   Create `src/lib/mcpLogger.ts` (or similar):

   ```typescript
   import { buildLogger } from "@nanostores/logger";
   import type { AnyStore } from "nanostores";

   interface NanostoresLoggerEvent {
   	kind: "mount" | "unmount" | "change" | "action-start" | "action-end" | "action-error";
   	storeName: string;
   	timestamp: number;
   	[key: string]: unknown;
   }

   class McpLoggerClient {
   	private url: string;
   	private buffer: NanostoresLoggerEvent[] = [];
   	private flushTimer: ReturnType<typeof setTimeout> | null = null;

   	constructor(url?: string) {
   		this.url = url || "http://127.0.0.1:3999/nanostores-logger";
   	}

   	send(event: NanostoresLoggerEvent) {
   		this.buffer.push(event);

   		// Batch events to reduce HTTP calls
   		if (!this.flushTimer) {
   			this.flushTimer = setTimeout(() => this.flush(), 100);
   		}
   	}

   	private async flush() {
   		if (this.buffer.length === 0) return;

   		const events = [...this.buffer];
   		this.buffer = [];
   		this.flushTimer = null;

   		try {
   			await fetch(this.url, {
   				method: "POST",
   				headers: { "Content-Type": "application/json" },
   				body: JSON.stringify({ events }),
   			});
   		} catch (err) {
   			// Silent fail - logger should not break the app
   			console.warn("[MCP Logger] Failed to send events:", err);
   		}
   	}

   	handlersFor(storeName: string) {
   		return {
   			mount: () => {
   				this.send({ kind: "mount", storeName, timestamp: Date.now() });
   			},
   			unmount: () => {
   				this.send({ kind: "unmount", storeName, timestamp: Date.now() });
   			},
   			change: (payload: any) => {
   				this.send({
   					kind: "change",
   					storeName,
   					timestamp: Date.now(),
   					actionId: payload.actionId,
   					actionName: payload.actionName,
   					changed: payload.changed,
   					valueMessage: payload.valueMessage,
   				});
   			},
   			action: {
   				start: (payload: any) => {
   					this.send({
   						kind: "action-start",
   						storeName,
   						timestamp: Date.now(),
   						actionId: payload.actionId,
   						actionName: payload.actionName,
   						args: payload.args,
   					});
   				},
   				end: (payload: any) => {
   					this.send({
   						kind: "action-end",
   						storeName,
   						timestamp: Date.now(),
   						actionId: payload.actionId,
   						actionName: payload.actionName,
   					});
   				},
   				error: (payload: any) => {
   					this.send({
   						kind: "action-error",
   						storeName,
   						timestamp: Date.now(),
   						actionId: payload.actionId,
   						actionName: payload.actionName,
   						error: String(payload.error),
   					});
   				},
   			},
   		};
   	}
   }

   // Global instance
   let mcpLogger: McpLoggerClient | null = null;

   export function initMcpLogger(url?: string) {
   	if (import.meta.env.DEV && !mcpLogger) {
   		mcpLogger = new McpLoggerClient(url);
   	}
   }

   export function attachMcpLogger(store: AnyStore, storeName: string) {
   	if (!mcpLogger) return () => {};
   	return buildLogger(store, storeName, mcpLogger.handlersFor(storeName));
   }
   ```

3. **Initialize in your app:**

   ```typescript
   // In your app entry point (main.tsx, App.tsx, etc.)
   import { initMcpLogger, attachMcpLogger } from "./lib/mcpLogger";
   import { $counter, $cart, $user } from "./stores";

   if (import.meta.env.DEV) {
   	initMcpLogger(); // uses default localhost:3999

   	// Attach logger to stores you want to monitor
   	attachMcpLogger($counter, "counter");
   	attachMcpLogger($cart, "cart");
   	attachMcpLogger($user, "user");
   }
   ```

4. **Auto-attach for all stores (optional):**

   If you want to automatically instrument all stores, create a registry:

   ```typescript
   // stores/index.ts
   import { atom, map } from "nanostores";
   import { attachMcpLogger } from "../lib/mcpLogger";

   const stores = new Map();

   export function createAtom<T>(name: string, initial: T) {
   	const store = atom(initial);
   	stores.set(name, store);

   	if (import.meta.env.DEV) {
   		attachMcpLogger(store, name);
   	}

   	return store;
   }

   export function createMap<T>(name: string) {
   	const store = map<T>();
   	stores.set(name, store);

   	if (import.meta.env.DEV) {
   		attachMcpLogger(store, name);
   	}

   	return store;
   }

   // Usage:
   export const $counter = createAtom("counter", 0);
   export const $cart = createMap<CartItem>("cart");
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
   # Should show "Logger Bridge: enabled"
   ```

2. Check URL in client matches server:

   ```typescript
   initMcpLogger("http://127.0.0.1:3999/nanostores-logger");
   ```

3. Check browser console for fetch errors

4. Verify stores are being mounted (interact with your app)

### Port already in use

Change the port:

```bash
NANOSTORES_MCP_LOGGER_PORT=4000 npm run dev
```

And update client:

```typescript
initMcpLogger("http://127.0.0.1:4000/nanostores-logger");
```

### Events truncated

Increase buffer size (server side):

```typescript
// In server.ts
const loggerEventStore = new LoggerEventStore(10000); // default: 5000
```

## Performance Considerations

- **Dev only**: Never enable in production (check `import.meta.env.DEV` or `NODE_ENV`)
- **Batching**: Client batches events (100ms) to reduce HTTP overhead
- **Buffer size**: Server uses ring buffer (default 5000 events) - oldest are dropped
- **Async**: Event sending is async and won't block renders
- **Error handling**: Failed sends are silently logged, won't crash app

## Security

- **Localhost only**: Bridge listens on `127.0.0.1` by default
- **No authentication**: Assumes local development environment
- **Payload limits**: 1MB max request size
- **Data masking**: Consider truncating large values in client before sending

## Future Enhancements

Potential additions (not yet implemented):

- WebSocket transport for lower latency
- IPC transport for Node.js apps
- Client package: `@nanostores/mcp-logger` with ready-made transport
- Value masking helpers for sensitive data
- Event replay functionality
- Export events to JSON/CSV for analysis
