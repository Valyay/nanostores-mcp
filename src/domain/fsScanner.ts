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

export type SubscriberKind = "component" | "hook" | "effect" | "unknown";

export interface StoreMatch {
	/** Идентификатор store-узла в графе: store:relativePath#name */
	id: string;
	/** Путь файла относительно rootDir */
	file: string;
	line: number;
	kind: StoreKind;
	/** Имя переменной, например $counter */
	name?: string;
}

export interface SubscriberMatch {
	/** Идентификатор подписчика: subscriber:relativePath[#Name] */
	id: string;
	file: string;
	line: number;
	kind: SubscriberKind;
	name?: string;
	/** На какие stores подписан этот подписчик (по relations типа subscribes_to) */
	storeIds: string[];
}

export type GraphEdgeType = "declares" | "subscribes_to" | "derives_from";

export interface StoreRelation {
	type: GraphEdgeType;
	from: string;
	to: string;
	file?: string;
	line?: number;
}

export interface ProjectIndex {
	rootDir: string;
	filesScanned: number;
	stores: StoreMatch[];
	subscribers: SubscriberMatch[];
	relations: StoreRelation[];
}

interface DerivedStub {
	derivedVar: string;
	dependsOnVar: string;
	file: string;
	line: number;
}

/**
 * Публичный API домена:
 * просканировать проект и собрать индекс nanostores:
 * - stores
 * - subscribers (компоненты/хуки/эффекты, которые читают stores)
 * - relations (declares / subscribes_to / derives_from)
 */
export async function scanProject(rootDir: string): Promise<ProjectIndex> {
	const absRoot = path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir);

	const stat = await fs.stat(absRoot);
	if (!stat.isDirectory()) {
		throw new Error(`Provided root is not a directory: ${absRoot}`);
	}

	const files: string[] = [];
	await walkDir(absRoot, files);

	const fileTexts = new Map<string, string>();
	const stores: StoreMatch[] = [];
	const subscribers: SubscriberMatch[] = [];
	const relations: StoreRelation[] = [];

	// storeName -> StoreMatch[]
	const storesByName = new Map<string, StoreMatch[]>();
	const derivedStubs: DerivedStub[] = [];

	// --- Первый проход: читаем файлы, находим stores + черновые зависимости derived -> base по именам ---

	for (const absPath of files) {
		const text = await fs.readFile(absPath, "utf8");
		fileTexts.set(absPath, text);

		const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);
		const lines = text.split(/\r?\n/);

		const storeDeclRegex =
			/\bconst\s+([A-Za-z0-9_$]+)\s*=\s*(atom|map|computed|persistentAtom|persistentMap|atomFamily|mapTemplate|computedTemplate)\s*\(/;

		const storeTokenRegex = /\$[A-Za-z0-9_]+/g;

		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];

			const declMatch = storeDeclRegex.exec(line);
			if (!declMatch) continue;

			const [, varName, ctorName] = declMatch;
			const kind = normalizeStoreKind(ctorName);

			const id = `store:${relativeFile}#${varName}`;

			const store: StoreMatch = {
				id,
				file: relativeFile,
				line: i + 1,
				kind,
				name: varName,
			};
			stores.push(store);

			const byName = storesByName.get(varName) ?? [];
			byName.push(store);
			storesByName.set(varName, byName);

			// file -> store
			relations.push({
				type: "declares",
				from: `file:${relativeFile}`,
				to: id,
				file: relativeFile,
				line: i + 1,
			});

			// Если это derived store (computed / templates), попробуем найти на этой строке зависимости на другие stores
			if (isDerivedKind(kind)) {
				storeTokenRegex.lastIndex = 0;
				let tokenMatch: RegExpExecArray | null;
				while ((tokenMatch = storeTokenRegex.exec(line)) !== null) {
					const tokenName = tokenMatch[0];
					if (tokenName === varName) continue;

					derivedStubs.push({
						derivedVar: varName,
						dependsOnVar: tokenName,
						file: relativeFile,
						line: i + 1,
					});
				}
			}
		}
	}

	// --- Второй проход: находим подписчиков (subscribers) и связи subscribes_to: subscriber -> store ---

	for (const absPath of files) {
		const text = fileTexts.get(absPath);
		if (!text) continue;

		const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);
		const lines = text.split(/\r?\n/);

		const useStoreRegex = /\buseStore\s*\(\s*([A-Za-z0-9_$]+)/g;

		const storeIds = new Set<string>();
		let firstUseLine: number | undefined;

		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];

			useStoreRegex.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = useStoreRegex.exec(line)) !== null) {
				const storeVarName = match[1];

				const matches = storesByName.get(storeVarName) ?? [];
				for (const store of matches) {
					storeIds.add(store.id);
				}

				if (matches.length > 0 && firstUseLine === undefined) {
					firstUseLine = i + 1;
				}
			}
		}

		if (storeIds.size > 0) {
			const subscriberId = `subscriber:${relativeFile}`;
			const kind = inferSubscriberKind(relativeFile);

			const baseName = path.basename(relativeFile, path.extname(relativeFile));

			const subscriber: SubscriberMatch = {
				id: subscriberId,
				file: relativeFile,
				line: firstUseLine ?? 1,
				kind,
				name: baseName,
				storeIds: Array.from(storeIds),
			};

			subscribers.push(subscriber);

			for (const storeId of storeIds) {
				relations.push({
					type: "subscribes_to",
					from: subscriberId,
					to: storeId,
					file: relativeFile,
					line: firstUseLine,
				});
			}
		}
	}

	// --- Третий проход: резолвим derived -> base (derives_from) по stub-ам ---

	for (const stub of derivedStubs) {
		const derivedMatches = storesByName.get(stub.derivedVar) ?? [];
		const baseMatches = storesByName.get(stub.dependsOnVar) ?? [];

		for (const derivedStore of derivedMatches) {
			for (const baseStore of baseMatches) {
				relations.push({
					type: "derives_from",
					from: derivedStore.id,
					to: baseStore.id,
					file: stub.file,
					line: stub.line,
				});
			}
		}
	}

	return {
		rootDir: absRoot,
		filesScanned: files.length,
		stores,
		subscribers,
		relations,
	};
}

/**
 * Рекурсивный обход директорий с игнором служебных / тяжёлых папок.
 */
async function walkDir(currentDir: string, files: string[]): Promise<void> {
	let entries: Dirent[];

	try {
		entries = await fs.readdir(currentDir, { withFileTypes: true });
	} catch (error) {
		const err = error as NodeJS.ErrnoException;

		if (err.code === "EACCES" || err.code === "EPERM" || err.code === "ENOENT") {
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

function normalizeStoreKind(raw: string): StoreKind {
	switch (raw) {
		case "atom":
		case "map":
		case "computed":
		case "persistentAtom":
		case "persistentMap":
		case "atomFamily":
		case "mapTemplate":
		case "computedTemplate":
			return raw;
		default:
			return "unknown";
	}
}

function isDerivedKind(kind: StoreKind): boolean {
	return (
		kind === "computed" ||
		kind === "mapTemplate" ||
		kind === "computedTemplate" ||
		kind === "atomFamily"
	);
}

function inferSubscriberKind(relativeFile: string): SubscriberKind {
	const ext = path.extname(relativeFile);
	const base = path.basename(relativeFile, ext);

	if (base.startsWith("use")) {
		return "hook";
	}

	if (ext === ".tsx" || ext === ".jsx") {
		return "component";
	}

	return "unknown";
}
