import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeFsPath, resolveSafePath, realpathSafe, uriToFsPath } from "./security.js";
import { envConfig } from "./envConfig.js";

export interface WorkspaceRoot {
	/** Original URI (if exists) or generated from fsPath. */
	uri: string;
	/** Human-readable root name (optional). */
	name?: string;
	/** Normalized file system path. */
	fsPath: string;
}

let cachedEnvRoots: string[] | null = null;
let cachedWorkspaceRoots: WorkspaceRoot[] | null = null;
let clientRoots: WorkspaceRoot[] | null = null;

/**
 * Read roots from environment.
 *
 * Supports:
 * - NANOSTORES_MCP_ROOTS — list via path.delimiter (/foo:/bar or /foo;/bar)
 * - NANOSTORES_MCP_ROOT  — single path
 * - WORKSPACE_FOLDER_PATHS / WORKSPACE_FOLDER — as in some hosts (Cursor, etc.)
 */
export function getEnvWorkspaceRoots(): string[] {
	if (cachedEnvRoots) return cachedEnvRoots;

	const roots: string[] = [];
	const delimiter = path.delimiter;

	const multi = envConfig.NANOSTORES_MCP_ROOTS;
	if (multi) {
		for (const raw of multi.split(delimiter)) {
			const trimmed = raw.trim();
			if (trimmed) roots.push(normalizeFsPath(trimmed));
		}
	}

	const single =
		envConfig.NANOSTORES_MCP_ROOT || envConfig.WORKSPACE_FOLDER || envConfig.WORKSPACE_FOLDER_PATHS;

	if (single) {
		for (const raw of single.split(delimiter)) {
			const trimmed = raw.trim();
			if (trimmed) roots.push(normalizeFsPath(trimmed));
		}
	}

	cachedEnvRoots = Array.from(new Set(roots));
	return cachedEnvRoots;
}

/**
 * Main source of FS access rights for nanostores-mcp.
 *
 * Priority:
 * 1. Explicit roots from env (NANOSTORES_MCP_ROOTS / NANOSTORES_MCP_ROOT / WORKSPACE_*).
 * 2. Client roots from MCP roots/list capability.
 * 3. process.cwd() as the only root.
 */
export function getWorkspaceRoots(): WorkspaceRoot[] {
	if (cachedWorkspaceRoots) return cachedWorkspaceRoots;

	const envRoots = getEnvWorkspaceRoots();

	if (envRoots.length) {
		cachedWorkspaceRoots = envRoots.map(fsPath => {
			const finalPath = realpathSafe(fsPath);
			return {
				fsPath: finalPath,
				uri: pathToFileURL(finalPath).href,
				name: undefined,
			};
		});
	} else if (clientRoots && clientRoots.length) {
		cachedWorkspaceRoots = clientRoots;
	} else {
		const cwdPath = realpathSafe(normalizeFsPath(process.cwd()));
		cachedWorkspaceRoots = [
			{
				fsPath: cwdPath,
				uri: pathToFileURL(cwdPath).href,
				name: undefined,
			},
		];
	}

	return cachedWorkspaceRoots;
}

/**
 * Only FS paths from roots.
 */
export function getWorkspaceRootPaths(): string[] {
	return getWorkspaceRoots().map(root => root.fsPath);
}

/**
 * Resolve any uri/path to ensure it lies
 * inside current workspace roots.
 *
 * If path goes outside bounds — throw error.
 */
export function resolveWorkspacePath(uriOrPath: string): string {
	const roots = getWorkspaceRootPaths();
	return resolveSafePath(uriOrPath, roots);
}

/**
 * Your old API, but now with roots consideration.
 *
 * 1) If rootUri not provided — take first root.
 * 2) If provided — try to safely resolve it inside roots.
 */
export function resolveWorkspaceRoot(rootUri?: string): string {
	const roots = getWorkspaceRootPaths();

	if (!roots.length) {
		throw new Error("No workspace roots configured; cannot resolve workspace root.");
	}

	if (!rootUri || rootUri.trim().length === 0) {
		return roots[0];
	}

	// if rootUri is file:// or relative/absolute path — check that it's inside roots
	return resolveWorkspacePath(rootUri);
}

/**
 * Apply workspace roots received from the MCP client via roots/list.
 * Converts URIs to validated filesystem paths and invalidates the workspace cache.
 */
export function setClientRoots(roots: Array<{ uri: string; name?: string }>): void {
	clientRoots = roots.map(root => {
		const fsPath = realpathSafe(uriToFsPath(root.uri));
		return {
			fsPath,
			uri: pathToFileURL(fsPath).href,
			name: root.name,
		};
	});
	cachedWorkspaceRoots = null;
}

/**
 * Clear client roots (e.g., when a client disconnects).
 */
export function clearClientRoots(): void {
	clientRoots = null;
	cachedWorkspaceRoots = null;
}

/**
 * Reset all caches. Only for tests.
 */
export function resetForTesting(): void {
	cachedEnvRoots = null;
	cachedWorkspaceRoots = null;
	clientRoots = null;
}
