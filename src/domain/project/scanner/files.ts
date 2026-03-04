import fs from "node:fs/promises";
import { globby } from "globby";

export const SOURCE_GLOB_PATTERN = "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}";

export const SOURCE_IGNORE_PATTERNS = [
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/.next/**",
	"**/.turbo/**",
	"**/coverage/**",
];

/**
 * Discover all source files in a project root using the standard
 * glob pattern and ignore list.
 */
export async function discoverSourceFiles(absRoot: string): Promise<string[]> {
	return globby(SOURCE_GLOB_PATTERN, {
		cwd: absRoot,
		absolute: true,
		gitignore: true,
		onlyFiles: true,
		ignore: SOURCE_IGNORE_PATTERNS,
	});
}

/**
 * Get the maximum mtime (in ms since epoch) across a list of files.
 * Returns 0 for an empty list. If a file cannot be stat'd it is skipped.
 */
export async function getFilesMaxMtime(files: readonly string[]): Promise<number> {
	if (files.length === 0) return 0;

	const mtimes = await Promise.all(
		files.map(f =>
			fs
				.stat(f)
				.then(s => s.mtimeMs)
				.catch(() => 0),
		),
	);

	return Math.max(...mtimes);
}
