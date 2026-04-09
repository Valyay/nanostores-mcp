# Contributing

## Prerequisites

- Node.js `^20.0.0 || >=22.0.0`
- pnpm `>=10`

## Setup

```bash
git clone https://github.com/Valyay/nanostores-mcp.git
cd nanostores-mcp
pnpm install
```

## Development

```bash
pnpm dev          # run MCP server with tsx
pnpm test:watch   # run tests in watch mode
```

## Before submitting a PR

All checks must pass:

```bash
pnpm run check    # lint + format + tests + build
pnpm run knip     # unused exports / dead dependencies
```

Fix formatting automatically with:

```bash
pnpm run format:fix
pnpm run lint:fix
```

## Project structure

```
src/
  cli.ts                  # CLI entry point (npx nanostores-mcp)
  server.ts               # MCP server setup
  domain/                 # core business logic
    project/              # static analysis (AST scanning, graph)
    runtime/              # live event tracking
    docs/                 # documentation search
  mcp/
    tools/                # MCP tool handlers
    prompts/              # MCP prompt handlers
    resources/            # MCP resource handlers
  client/
    mcpLogger.ts          # @nanostores/logger bridge for client apps
test/
  unit/                   # unit tests
  integration/            # integration tests (MCP protocol level)
```

## Commit style

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.

Keep commits atomic — one logical change per commit.
