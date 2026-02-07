# Repository Review: nanostores-mcp

> Compared against official MCP reference servers (`@modelcontextprotocol/servers`),
> top community servers (GitHub MCP, Playwright MCP, Sentry MCP, Docker MCP),
> and the MCP specification (2025-11-25).

---

## Executive Summary

**nanostores-mcp** is an unusually well-architected MCP server for a v0.1.0 project. The layered domain design, AST-based static analysis, runtime event bridge, and multi-framework SFC support are genuinely impressive — most community MCP servers are flat single-file scripts. The codebase has real engineering behind it.

That said, the comparison with mature ecosystem servers reveals concrete gaps in **error protocol compliance**, **testing at the MCP wire level**, **CI/CD**, **security documentation**, and **transport flexibility**. None of these are fatal, but addressing them would move this from "solid personal project" to "production-grade ecosystem tool."

---

## Scorecard

| Dimension | Score | Notes |
|---|:---:|---|
| Architecture & Code Organization | **A** | Clean layered design (domain → service → feature → MCP). Better than most reference servers. |
| Type Safety | **A** | Strict TS, Zod schemas on all tool I/O, discriminated unions for events. |
| MCP Protocol Compliance | **B-** | Missing `isError` flag on error responses, no `McpError` usage, SDK slightly outdated. |
| Error Handling | **B** | Graceful degradation is good, but errors are invisible to LLM retry logic without `isError`. |
| Testing | **B-** | Good domain-level coverage, but zero MCP protocol-level tests. No coverage reporting. |
| Security | **B** | Path validation and localhost-only bridge are solid. No SECURITY.md, no dedicated README section. |
| Documentation | **B+** | README and LOGGER_INTEGRATION.md are thorough. Missing CHANGELOG, CONTRIBUTING, security docs. |
| CI/CD & Release | **D** | No GitHub Actions, no automated checks on PR, no `prepare` script, no release automation. |
| Transport & Deployment | **C** | stdio only. No Streamable HTTP option. No Docker image. |
| package.json Conventions | **B** | Good exports map, but missing `prepare` script, `mcpName`, outdated SDK version. |

**Overall: B+** — Strong foundation, clear gaps in operational maturity.

---

## Detailed Findings

### 1. MCP Protocol Compliance

**Problem: Error responses don't signal errors to the LLM.**

Every tool handler catches errors and returns them as plain text:

```typescript
// Current pattern (src/mcp/tools/storeSummary.ts)
catch (error) {
  const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
  return {
    content: [{ type: "text", text: "Failed to get store summary.\n\n" + `Error: ${msg}` }],
  };
}
```

The MCP spec defines a two-level error model:
- **Protocol errors**: `McpError` with JSON-RPC error codes — for invalid requests, missing params
- **Tool execution errors**: `isError: true` in `CallToolResult` — signals the LLM that the call failed and it should retry or adjust

Without `isError: true`, the LLM treats error text as a successful result. This means it won't retry, won't try a different tool, and may hallucinate on top of the error message.

**Problem: `throw new Error()` in tool handlers.**

```typescript
// src/mcp/tools/storeSummary.ts:99
if (!storeId && !name) {
  throw new Error("Either 'storeId' or 'name' must be provided");
}
```

Unhandled throws in tool handlers surface as opaque protocol errors. This should be a `McpError(ErrorCode.InvalidParams, ...)` or a returned `isError: true` response.

**Problem: SDK version is behind.**

`@modelcontextprotocol/sdk` is at `^1.23.0`. The current version is `^1.26.0+`. Newer versions include `registerTool()` with annotations, Streamable HTTP transport, and bug fixes.

---

### 2. Testing

**Problem: Zero MCP protocol-level tests.**

All 15 test files test domain logic and services — which is good — but no test ever instantiates an `McpServer`, connects a `Client` via `InMemoryTransport`, and calls a tool through the wire protocol.

The official servers all use this pattern:

```typescript
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(clientTransport);

const result = await client.callTool({ name: "scan_project", arguments: { root: "/tmp" } });
expect(result.content[0].text).toContain("stores found");
```

This catches issues that unit tests miss: schema serialization bugs, tool registration errors, capability negotiation failures.

**Problem: No test coverage reporting.**

The official servers use `@vitest/coverage-v8`. Without coverage metrics, there's no way to know what's tested.

**Problem: No resource or prompt tests.**

16 resources and 5 prompts are registered but none are tested. A `client.readResource()` or `client.getPrompt()` test through InMemoryTransport would catch registration bugs.

---

### 3. Error Handling Specifics

**Problem: Silent swallowing of logger bridge failures.**

```typescript
// src/server.ts:46-48
loggerBridge.start().catch(() => {
  // Silent fail - bridge is optional
});
```

If the bridge fails to start (port conflict, permission error), the user has no idea. At minimum, this should log to `stderr`.

**Problem: Scanner error reporting is limited.**

The scanner silently skips files with parse errors (up to 5 logged). If a user's main store file has a syntax error, it's invisible. The scan result should include a `warnings` or `skippedFiles` field.

---

### 4. Security

**What's good:**
- `security.ts` resolves symlinks and validates path containment — matches the filesystem reference server pattern
- Logger bridge binds to `127.0.0.1` by default
- Event validation with size limits (1MB)
- Path allowlist via `NANOSTORES_MCP_ROOT` / `NANOSTORES_MCP_ROOTS`

**What's missing:**
- No `SECURITY.md` with vulnerability reporting instructions
- No dedicated security section in README
- No rate limiting on the logger bridge HTTP endpoint
- No CORS origin validation (currently sends permissive CORS headers)
- Error messages in tool responses may leak internal file paths — official servers sanitize these

---

### 5. CI/CD and Release Process

**Problem: No CI pipeline at all.**

No `.github/workflows/` directory. The `pnpm run check` script exists locally but nothing enforces it on PRs. Every official and major community server has GitHub Actions for:
- Lint + format check
- Test suite
- Build verification
- (Optional) Release automation with changesets or semantic-release

**Problem: No `prepare` script.**

Official servers use `"prepare": "npm run build"` so the package is built automatically on `npm install` from git. This matters for contributors.

**Problem: No CHANGELOG.**

No way for users to know what changed between versions. This becomes critical after v1.0.

---

### 6. Transport Limitations

**Problem: stdio only.**

The server only supports `StdioServerTransport`. The MCP ecosystem is moving toward **Streamable HTTP** as the recommended remote transport (SSE is deprecated). Adding Streamable HTTP support would enable:
- Remote development setups
- Docker-based deployments
- Multi-client connections
- Web-based MCP clients

The "everything" reference server demonstrates multi-transport support via CLI args.

---

### 7. package.json Gaps

| Field | Current | Recommended |
|---|---|---|
| `prepare` | missing | `"npm run build"` |
| `mcpName` | missing | `"io.github.valyay/nanostores-mcp"` |
| `test` script | `"vitest run"` | `"vitest run --coverage"` |
| SDK version | `^1.23.0` | `^1.26.0` |
| `build` script | `tsc -p tsconfig.json` | `tsc && shx chmod +x dist/*.js` (ensures CLI is executable) |

---

### 8. Documentation Gaps

| Document | Status | Priority |
|---|---|---|
| README.md | Good, comprehensive | Low — minor improvements |
| CHANGELOG.md | Missing | High |
| CONTRIBUTING.md | Missing (one line in README) | Medium |
| SECURITY.md | Missing | High |
| GitHub issue templates | Missing | Medium |
| GitHub Actions CI badge | Missing | Medium (after CI exists) |

---

### 9. Code-Level Observations

**Two open TODOs:**

```typescript
// src/mcp/shared/storeSummary.ts:108, 118
// TODO: expose edges from domain layer
```

The `relations` arrays in structured content are hardcoded to `[]`. This means the LLM never sees store dependency edges in tool results — a significant data gap for the "explain store" and "debug store" workflows.

**Module-level side effects in `server.ts`:**

All domain services, the logger bridge, and the docs infrastructure are instantiated at module import time:

```typescript
// These run on import, not on buildNanostoresServer()
const projectIndexRepository = createProjectIndexRepository(30_000);
const loggerEventStore = createLoggerEventStore(5000);
const loggerBridge = createLoggerBridge(loggerEventStore, { ... });
```

This makes testing harder (can't mock services) and prevents running multiple server instances. The official pattern is to instantiate inside the factory function.

---

## Improvement Directions

### Priority 1: Protocol Compliance (High Impact, Low Effort)

1. **Add `isError: true` to all error responses in tool handlers.** This is the single highest-impact change — it lets LLMs distinguish failures from results.

2. **Replace `throw new Error()` in tool handlers with `McpError(ErrorCode.InvalidParams, ...)`** for input validation failures, and `isError: true` returns for execution failures.

3. **Bump `@modelcontextprotocol/sdk` to `^1.26.0`** to get latest protocol features and fixes.

### Priority 2: MCP-Level Integration Tests (High Impact, Medium Effort)

4. **Add `InMemoryTransport` integration tests** that exercise tools, resources, and prompts through the actual MCP wire protocol. Start with one test per feature area (static, runtime, docs).

5. **Add `@vitest/coverage-v8`** and a coverage threshold in vitest config.

### Priority 3: CI/CD Pipeline (High Impact, Medium Effort)

6. **Add GitHub Actions workflow** with lint, format, test, and build steps on push/PR.

7. **Add `prepare` script** to package.json.

8. **Add CHANGELOG.md** — even a manual one. Consider `changesets` for automation.

### Priority 4: Security Hardening (Medium Impact, Low Effort)

9. **Create SECURITY.md** with vulnerability reporting instructions.

10. **Add a Security section to README** consolidating the scattered security guidance.

11. **Log logger bridge failures to stderr** instead of silently swallowing.

12. **Sanitize file paths in error messages** returned to LLM — strip workspace root prefixes.

### Priority 5: Error Quality (Medium Impact, Low Effort)

13. **Include `skippedFiles` and `warnings` in scan results** so the user knows when files failed to parse.

14. **Resolve the two TODOs** — expose dependency edges in structured content. This is the data the LLM most needs for "explain store" workflows.

### Priority 6: Transport & Deployment (Medium Impact, High Effort)

15. **Add Streamable HTTP transport** as an alternative to stdio, selectable via CLI arg.

16. **Add a Dockerfile** for containerized deployment.

17. **Add multi-transport CLI args** following the "everything" server pattern: `nanostores-mcp stdio` / `nanostores-mcp http`.

### Priority 7: Developer Experience (Low Impact, Low Effort)

18. **Add CONTRIBUTING.md** with setup instructions, architecture overview, and PR guidelines.

19. **Add GitHub issue templates** (bug report, feature request).

20. **Move service instantiation inside `buildNanostoresServer()`** to enable testing and multiple instances.

21. **Add `mcpName` field** to package.json following the new reverse-DNS convention.

---

## What You're Doing Better Than Most

To be clear about what doesn't need fixing:

- **Layered architecture** — Most MCP servers are single-file scripts. Your domain/service/feature/MCP separation is genuinely better than the official reference servers.
- **Dual output** (text + `structuredContent`) — Many servers return only text. Your structured output enables richer client UIs.
- **Zod on both input and output** — Most servers only validate input. Output schemas are a differentiator.
- **Multi-framework SFC support** — Vue and Svelte SFC parsing is non-trivial and well-implemented.
- **Resource links in tool results** — Using `resourceLinks` to connect tools to resources is an advanced pattern most servers skip.
- **Prompt design** — Your prompts include autocomplete and retrieval instructions. This is more thoughtful than any reference server's prompts.
- **Ring buffer event store** — Practical bounded-memory design for runtime events.
- **Path security** — Symlink resolution + containment checks match the filesystem reference server.

---

*Review generated 2026-02-07. Compared against MCP SDK v1.26.0, official reference servers, and top community servers.*
