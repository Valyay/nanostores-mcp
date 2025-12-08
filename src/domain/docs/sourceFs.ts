import { globby } from "globby";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Configuration for file system docs source
 */
export interface DocsSourceConfig {
	rootDir: string; // where to get md/mdx
	patterns?: string[]; // e.g., ["**/*.md", "**/*.mdx"]
}

/**
 * Interface for docs source (can be FS, HTTP, etc.)
 */
export interface DocsSource {
	listFiles(): Promise<string[]>;
	readFile(path: string): Promise<string>;
}

/**
 * Create a file system-based docs source
 */
export function createFsDocsSource(config: DocsSourceConfig): DocsSource {
	const patterns = config.patterns || ["**/*.md", "**/*.mdx"];

	return {
		async listFiles(): Promise<string[]> {
			const files = await globby(patterns, {
				cwd: config.rootDir,
				absolute: true,
				onlyFiles: true,
			});

			return files;
		},

		async readFile(path: string): Promise<string> {
			const absolutePath = resolve(config.rootDir, path);
			return readFile(absolutePath, "utf-8");
		},
	};
}
