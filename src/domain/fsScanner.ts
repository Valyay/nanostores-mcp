import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	"dist",
	"build",
	".next",
	".turbo",
	".cache",
	"coverage",
]);

const SOURCE_EXT_REGEX = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export type StoreKind =
	| "atom"
	| "map"
	| "computed"
	| "persistentAtom"
	| "persistentMap"
	| "atomFamily"
	| "mapTemplate"
	| "computedTemplate"
	| "unknown";

export interface StoreMatch {
	id: string;
	file: string; // путь относительно root
	line: number;
	kind: StoreKind;
	name?: string;
}

export interface ScanResult {
	rootDir: string;
	filesScanned: number;
	stores: StoreMatch[];
}

/**
 * Публичный API домена: просканировать проект на nanostores.
 */
export async function scanProject(rootDir: string): Promise<ScanResult> {
	const absRoot = path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir);

	const stat = await fs.stat(absRoot);
	if (!stat.isDirectory()) {
		throw new Error(`Provided root is not a directory: ${absRoot}`);
	}

	const files: string[] = [];
	await walkDir(absRoot, files);

	let filesScanned = 0;
	const allStores: StoreMatch[] = [];

	for (const filePath of files) {
		filesScanned += 1;
		const storesInFile = await scanFileForStores(absRoot, filePath);
		allStores.push(...storesInFile);
	}

	return {
		rootDir: absRoot,
		filesScanned,
		stores: allStores,
	};
}

/**
 * Рекурсивный обход директорий с игнором системных/закрытых папок.
 */
async function walkDir(currentDir: string, files: string[]): Promise<void> {
	let entries: Dirent[];

	try {
		entries = await fs.readdir(currentDir, { withFileTypes: true });
	} catch (error) {
		const err = error as NodeJS.ErrnoException;

		if (err.code === "EACCES" || err.code === "EPERM" || err.code === "ENOENT") {
			// Логируем в stderr, stdout MCP-протокола не трогаем
			console.error(
				"[nanostores-mcp] Skipping directory due to permissions or missing path:",
				currentDir,
				err.code,
			);
			return;
		}

		throw error;
	}

	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);

		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(entry.name)) continue;
			await walkDir(entryPath, files);
		} else if (entry.isFile()) {
			if (SOURCE_EXT_REGEX.test(entry.name)) {
				files.push(entryPath);
			}
		}
	}
}

/**
 * Очень простой анализ одного файла:
 * - есть ли упоминания "nanostores";
 * - есть ли импорт/require из nanostores / @nanostores/*;
 * - есть ли паттерны вида: const name = atom/map/computed/…(...)
 */
async function scanFileForStores(rootDir: string, filePath: string): Promise<StoreMatch[]> {
	const text = await fs.readFile(filePath, "utf8");

	if (!text.includes("nanostores")) return [];

	const hasNanostoresImport =
		/from\s+['"](?:nanostores|@nanostores\/[^'"]*)['"]/.test(text) ||
		/require\(\s*['"](?:nanostores|@nanostores\/[^'"]*)['"]\s*\)/.test(text);

	if (!hasNanostoresImport) return [];

	const relativeFile = path.relative(rootDir, filePath) || path.basename(filePath);

	const lines = text.split(/\r?\n/);
	const stores: StoreMatch[] = [];

	const storeDeclRegex =
		/\bconst\s+([A-Za-z0-9_$]+)\s*=\s*(atom|map|computed|persistentAtom|persistentMap|atomFamily|mapTemplate|computedTemplate)\s*\(/;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const match = storeDeclRegex.exec(line);
		if (!match) continue;

		const [, varName, kind] = match;
		const id = `${relativeFile}#${varName}`;

		stores.push({
			id,
			file: relativeFile,
			line: i + 1,
			kind: kind as StoreKind,
			name: varName,
		});
	}

	return stores;
}
