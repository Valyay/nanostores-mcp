import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import isPathInsideLib from "is-path-inside";

type ErrnoException = NodeJS.ErrnoException;

export function isErrnoException(error: unknown): error is ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

export function normalizeFsPath(fsPath: string): string {
	return path.resolve(fsPath);
}

export function uriToFsPath(uriOrPath: string): string {
	if (uriOrPath.startsWith("file://")) {
		// URL → absolute fs path
		return normalizeFsPath(fileURLToPath(uriOrPath));
	}

	return normalizeFsPath(uriOrPath);
}

/**
 * Safe realpath:
 * - normalizes path;
 * - attempts to resolve realpath;
 * - for non-existent files, realpath is done for the directory.
 */
export function realpathSafe(p: string): string {
	const normalized = normalizeFsPath(p);
	const realpathFn = fs.realpathSync.native ?? fs.realpathSync;

	try {
		return realpathFn(normalized);
	} catch (err: unknown) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			const dir = path.dirname(normalized);
			const base = path.basename(normalized);

			if (dir === normalized) {
				return normalized;
			}

			const realDir = realpathSafe(dir);
			return path.join(realDir, base);
		}

		throw err;
	}
}

/**
 * Check that target is inside root (considering symlinks).
 */
export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
	const targetReal = realpathSafe(targetPath);
	const rootReal = realpathSafe(rootPath);

	if (targetReal === rootReal) return true;

	return isPathInsideLib(targetReal, rootReal);
}

export function resolveSafePath(uriOrPath: string, roots: readonly string[]): string {
	if (!roots.length) {
		throw new Error("No workspace roots configured; cannot safely resolve filesystem path.");
	}

	const fsPath = uriToFsPath(uriOrPath);

	for (const root of roots) {
		if (isPathInsideRoot(fsPath, root)) {
			return realpathSafe(fsPath);
		}
	}

	const rootsList = roots.join(", ");
	throw new Error(`Path "${fsPath}" is outside of allowed roots: ${rootsList}`);
}
