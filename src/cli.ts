#!/usr/bin/env node
/**
 * CLI entry point for nanostores-mcp.
 * This is a thin shim that delegates to the main module.
 */

import { main } from "./index.js";

main().catch((error: unknown) => {
	const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`[nanostores-mcp] CLI error: ${detail}\n`);
	process.exit(1);
});
