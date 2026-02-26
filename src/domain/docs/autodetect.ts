import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { DocsSource } from "./sourceFs.js";
import { createFsDocsSource } from "./sourceFs.js";

/**
 * Describes how the docs source was resolved.
 */
export type DocsSourceInfo =
	| { kind: "env"; rootDir: string; patterns?: string[] }
	| {
			kind: "package";
			workspaceRoot: string;
			packageDir: string;
			packageVersion?: string;
			patterns: string[];
	  }
	| { kind: "none"; reason: string };

/**
 * Patterns that scan nanostores + @nanostores/* family inside node_modules/.
 * Globby runs with cwd = node_modules/, so paths come out as
 * "nanostores/README.md", "@nanostores/persistent/README.md", etc.
 *
 * No explicit README.md patterns — *.md already covers them
 * and avoids duplicates on case-insensitive filesystems (macOS).
 */
const FAMILY_DOC_PATTERNS = [
	"nanostores/docs/**/*.md",
	"nanostores/docs/**/*.mdx",
	"nanostores/*.md",
	"nanostores/*.mdx",
	"@nanostores/*/docs/**/*.md",
	"@nanostores/*/docs/**/*.mdx",
	"@nanostores/*/*.md",
	"@nanostores/*/*.mdx",
];

/**
 * Detect the best docs source for Nanostores documentation.
 *
 * Priority:
 * 1. Explicit env var (`envDocsRoot`) — honour user override.
 * 2. `nanostores` + `@nanostores/*` packages inside workspace `node_modules`.
 * 3. Nothing found.
 */
export function detectNanostoresDocsSource(params: {
	workspaceRoots: string[];
	envDocsRoot?: string;
	envPatterns?: string[];
}): { source: DocsSource | null; info: DocsSourceInfo } {
	// 1. Explicit env override
	if (params.envDocsRoot) {
		if (!existsSync(params.envDocsRoot)) {
			return {
				source: null,
				info: {
					kind: "none",
					reason: `NANOSTORES_DOCS_ROOT path does not exist: ${params.envDocsRoot}`,
				},
			};
		}

		return {
			source: createFsDocsSource({
				rootDir: params.envDocsRoot,
				patterns: params.envPatterns,
			}),
			info: {
				kind: "env",
				rootDir: params.envDocsRoot,
				patterns: params.envPatterns,
			},
		};
	}

	// 2. Auto-detect from node_modules (nanostores + @nanostores/* family)
	for (const root of params.workspaceRoots) {
		const packageDir = join(root, "node_modules", "nanostores");
		const packageJsonPath = join(packageDir, "package.json");

		if (!existsSync(packageJsonPath)) continue;

		// Best-effort version read
		let packageVersion: string | undefined;
		try {
			const raw = readFileSync(packageJsonPath, "utf-8");
			const parsed = JSON.parse(raw) as { version?: string };
			packageVersion = parsed.version;
		} catch {
			// ignore
		}

		// Scan node_modules/ with family patterns — picks up
		// nanostores core + all @nanostores/* ecosystem packages
		const nodeModulesDir = join(root, "node_modules");
		return {
			source: createFsDocsSource({
				rootDir: nodeModulesDir,
				patterns: FAMILY_DOC_PATTERNS,
			}),
			info: {
				kind: "package",
				workspaceRoot: root,
				packageDir,
				packageVersion,
				patterns: FAMILY_DOC_PATTERNS,
			},
		};
	}

	// 3. Nothing found
	return {
		source: null,
		info: {
			kind: "none",
			reason:
				"nanostores package not found in any workspace node_modules. " +
				"Install nanostores or set NANOSTORES_DOCS_ROOT.",
		},
	};
}
