#!/usr/bin/env node
/**
 * CLI entry point for nanostores-mcp.
 * This is a thin shim that delegates to the main module.
 */

import { main } from "./index.js";

main().catch(error => {
	// eslint-disable-next-line no-console
	console.error("[nanostores-mcp] CLI error:", error);
	process.exit(1);
});
