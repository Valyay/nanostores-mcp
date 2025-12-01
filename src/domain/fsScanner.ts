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

export type ConsumerKind = "file" | "component" | "hook";

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

export interface ConsumerMatch {
	/** Идентификатор consumer-узла в графе: consumer:relativePath[#Name] */
	id: string;
	/** Путь файла относительно rootDir */
	file: string;
	/** Примерная природа consumer-а (сейчас всегда 'file') */
	kind: ConsumerKind;
	/** Человеко-читаемое имя: компонент/хук или просто имя файла */
	name?: string;
	/** Первая строка, где встретилось использование store */
	line?: number;
}

export type RelationType = "declares" | "uses" | "depends_on";

export interface StoreRelation {
	type: RelationType;
	/** ID узла-источника (file:*, store:*, consumer:*) */
	from: string;
	/** ID узла-приёмника (store:*) */
	to: string;
	/** Для отладки: где это встретилось */
	file?: string;
	line?: number;
}

export interface ProjectIndex {
	rootDir: string;
	filesScanned: number;
	stores: StoreMatch[];
	consumers: ConsumerMatch[];
	relations: StoreRelation[];
}

// Внутренний тип для черновых зависимостей по именам
interface DependencyStub {
	fromStoreName: string;
	toStoreName: string;
	file: string;
	line: number;
}

/**
 * Публичный API домена: просканировать проект на Nanostores
 * и собрать индекс: stores, consumers, relations.
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
	const consumers: ConsumerMatch[] = [];
	const relations: StoreRelation[] = [];

	// storeName -> StoreMatch[]
	const storesByName = new Map<string, StoreMatch[]>();
	const dependencyStubs: DependencyStub[] = [];

	// --- Первый проход: читаем файлы, находим stores + черновые зависимости между store-ами ---

	for (const filePath of files) {
		const text = await fs.readFile(filePath, "utf8");
		fileTexts.set(filePath, text);

		const fileStores = scanTextForStores(absRoot, filePath, text, dependencyStubs);

		// добавляем в общий список stores
		for (const store of fileStores) {
			stores.push(store);

			if (store.name) {
				const arr = storesByName.get(store.name) ?? [];
				arr.push(store);
				storesByName.set(store.name, arr);
			}

			// связь file -> store (declares)
			relations.push({
				type: "declares",
				from: `file:${store.file}`,
				to: store.id,
				file: store.file,
				line: store.line,
			});
		}
	}

	// --- Второй проход: находим consumers и связи uses (consumer -> store) ---

	for (const filePath of files) {
		const text = fileTexts.get(filePath);
		if (!text) continue;

		const { consumers: fileConsumers, relations: fileRelations } = scanTextForConsumers(
			absRoot,
			filePath,
			text,
			storesByName,
		);

		consumers.push(...fileConsumers);
		relations.push(...fileRelations);
	}

	// --- Резолвим зависимости store -> store (depends_on) по stub-ам ---

	for (const stub of dependencyStubs) {
		const fromMatches = storesByName.get(stub.fromStoreName) ?? [];
		const toMatches = storesByName.get(stub.toStoreName) ?? [];

		for (const fromStore of fromMatches) {
			for (const toStore of toMatches) {
				if (fromStore.id === toStore.id) continue; // не ссылаемся сами на себя
				relations.push({
					type: "depends_on",
					from: fromStore.id,
					to: toStore.id,
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
		consumers,
		relations,
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
 * Парсим один файл на предмет объявлений stores и записываем
 * черновые зависимости между store-ами по именам.
 */
function scanTextForStores(
	rootDir: string,
	filePath: string,
	text: string,
	dependencyStubs: DependencyStub[],
): StoreMatch[] {
	const relativeFile = path.relative(rootDir, filePath) || path.basename(filePath);
	const lines = text.split(/\r?\n/);
	const stores: StoreMatch[] = [];

	const storeDeclRegex =
		/\bconst\s+([A-Za-z0-9_$]+)\s*=\s*(atom|map|computed|persistentAtom|persistentMap|atomFamily|mapTemplate|computedTemplate)\s*\(/;

	const storeTokenRegex = /\$[A-Za-z0-9_]+/g;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];

		const declMatch = storeDeclRegex.exec(line);
		if (!declMatch) continue;

		const [, varName, kind] = declMatch;
		const id = `store:${relativeFile}#${varName}`;

		stores.push({
			id,
			file: relativeFile,
			line: i + 1,
			kind: kind as StoreKind,
			name: varName,
		});

		// Попробуем найти на этой же строке зависимости на другие stores вида $something
		storeTokenRegex.lastIndex = 0;
		let tokenMatch: RegExpExecArray | null;
		while ((tokenMatch = storeTokenRegex.exec(line)) !== null) {
			const tokenName = tokenMatch[0];
			if (tokenName === varName) continue;

			dependencyStubs.push({
				fromStoreName: varName,
				toStoreName: tokenName,
				file: relativeFile,
				line: i + 1,
			});
		}
	}

	return stores;
}

/**
 * Находим в файле "подписчиков" на stores и связи uses: consumer -> store.
 *
 * Сейчас очень простой хак:
 * - consumer = сам файл (kind: 'file');
 * - поиск useStore($storeName);
 */
function scanTextForConsumers(
	rootDir: string,
	filePath: string,
	text: string,
	storesByName: Map<string, StoreMatch[]>,
): { consumers: ConsumerMatch[]; relations: StoreRelation[] } {
	const relativeFile = path.relative(rootDir, filePath) || path.basename(filePath);
	const lines = text.split(/\r?\n/);

	const useStoreRegex = /\buseStore\s*\(\s*([A-Za-z0-9_$]+)/g;

	const consumers: ConsumerMatch[] = [];
	const relations: StoreRelation[] = [];

	const consumerId = `consumer:${relativeFile}`;
	let firstUseLine: number | undefined;
	let hasConsumer = false;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];

		useStoreRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = useStoreRegex.exec(line)) !== null) {
			const storeVarName = match[1];

			if (!hasConsumer) {
				hasConsumer = true;
				firstUseLine = i + 1;
			}

			const storeMatches = storesByName.get(storeVarName) ?? [];
			for (const store of storeMatches) {
				relations.push({
					type: "uses",
					from: consumerId,
					to: store.id,
					file: relativeFile,
					line: i + 1,
				});
			}
		}
	}

	if (hasConsumer) {
		consumers.push({
			id: consumerId,
			file: relativeFile,
			kind: "file",
			name: relativeFile,
			line: firstUseLine,
		});
	}

	return { consumers, relations };
}
