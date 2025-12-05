# nanostores-mcp

> Model Context Protocol (MCP) server for Nanostores - provides static analysis and runtime monitoring of your nanostores state management.

## Features

### 📊 Static Analysis (AST-based)

- **Project scanning** - Find all stores, subscribers, and dependencies
- **Dependency graph** - Visualize store relationships with Mermaid diagrams
- **Store details** - Inspect store type (atom/map/computed), file location, usage

### 🔥 Runtime Monitoring (Logger Integration)

- **Live events** - Capture mount/unmount, changes, and action calls from `@nanostores/logger`
- **Performance analysis** - Find noisy stores, high error rates, unused stores
- **Activity metrics** - Track change frequency, action success/failure rates
- **Combined analysis** - Merge static structure with runtime behavior for comprehensive debugging

## Installation

```bash
npm install -g nanostores-mcp
```

Or use via npx:

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

For runtime analysis, integrate `@nanostores/logger` in your app. See [Logger Integration Guide](./docs/LOGGER_INTEGRATION.md) for detailed setup.

**Quick setup:**

```bash
npm install -D @nanostores/logger
```

Then in your app:

```typescript
import { buildLogger } from "@nanostores/logger";
import { $counter } from "./stores";

if (import.meta.env.DEV) {
	const sendEvent = event => {
		fetch("http://127.0.0.1:3999/nanostores-logger", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ events: [event] }),
		}).catch(() => {});
	};

	buildLogger($counter, "counter", {
		mount: ({ storeName }) =>
			sendEvent({
				kind: "mount",
				storeName,
				timestamp: Date.now(),
			}),
		unmount: ({ storeName }) =>
			sendEvent({
				kind: "unmount",
				storeName,
				timestamp: Date.now(),
			}),
		change: payload =>
			sendEvent({
				kind: "change",
				storeName: payload.storeName,
				timestamp: Date.now(),
				actionName: payload.actionName,
				valueMessage: payload.valueMessage,
			}),
		action: {
			start: p =>
				sendEvent({
					kind: "action-start",
					storeName: p.storeName,
					actionId: p.actionId,
					actionName: p.actionName,
					timestamp: Date.now(),
				}),
			end: p =>
				sendEvent({
					kind: "action-end",
					storeName: p.storeName,
					actionId: p.actionId,
					actionName: p.actionName,
					timestamp: Date.now(),
				}),
			error: p =>
				sendEvent({
					kind: "action-error",
					storeName: p.storeName,
					actionId: p.actionId,
					actionName: p.actionName,
					error: String(p.error),
					timestamp: Date.now(),
				}),
		},
	});
}
```

For a complete client integration, see [docs/LOGGER_INTEGRATION.md](./docs/LOGGER_INTEGRATION.md).

## MCP Resources

### Static Analysis

- `nanostores://graph` - Full dependency graph (text or Mermaid)
- `nanostores://graph#json` - Graph data in JSON format
- `nanostores://store/{key}` - Store details (by name or id)

### Runtime Monitoring

- `nanostores://runtime/events` - Recent logger events (filterable)
- `nanostores://runtime/stats` - Aggregated statistics
- `nanostores://runtime/store/{key}` - Runtime profile for specific store

## MCP Tools

### Static Analysis

- `scan_project` - Scan project for nanostores
- `store_summary` - Get summary of stores in a file

### Runtime Monitoring

- `nanostores_runtime_overview` - Overall health report
- `nanostores_store_activity` - Activity timeline for a store
- `nanostores_find_noisy_stores` - Find high-activity stores

### Utilities

- `ping` - Server health check (also reports logger bridge status)

## MCP Prompts

### Static Analysis

- `nanostores/explain-project` - Explain project structure
- `nanostores/explain-store` - Explain a specific store

### Runtime Debugging

- `nanostores/debug-store` - Deep analysis: static + runtime + recommendations
- `nanostores/debug-project-activity` - Project-wide performance analysis

## Example Queries

**"Show me the dependency graph"**
→ Uses `nanostores://graph` resource

**"Explain what the $cart store does"**
→ Uses `nanostores/explain-store` prompt

**"Which stores are causing the most re-renders?"**
→ Uses `nanostores_find_noisy_stores` tool

**"Debug the $user store"**
→ Uses `nanostores/debug-store` prompt with both static and runtime data

**"Are there any unused stores?"**
→ Uses `nanostores_runtime_overview` to find stores that were never mounted

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
