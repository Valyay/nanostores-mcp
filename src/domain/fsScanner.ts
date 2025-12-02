import fs from "node:fs/promises";
import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { globby } from "globby";

const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

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

// --- Кэширование индекса проекта ---

interface CacheEntry {
	index: ProjectIndex;
	timestamp: number;
}

const projectIndexCache = new Map<string, CacheEntry>();

/** TTL кэша в миллисекундах (по умолчанию 30 секунд) */
const CACHE_TTL_MS = 30_000;

/** Callback для отчёта о прогрессе сканирования */
export type ProgressCallback = (progress: number, total: number, message: string) => void;

export interface ScanOptions {
	/** Принудительно пересканировать, игнорируя кэш */
	force?: boolean;
	/** Кастомный TTL кэша в миллисекундах */
	cacheTtlMs?: number;
	/** Callback для отчёта о прогрессе */
	onProgress?: ProgressCallback;
}

/**
 * Очистить кэш индекса для конкретного root или весь кэш.
 */
export function clearProjectIndexCache(rootDir?: string): void {
	if (rootDir) {
		const absRoot = path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir);
		projectIndexCache.delete(absRoot);
	} else {
		projectIndexCache.clear();
	}
}

/**
 * Публичный API домена:
 * просканировать проект и собрать индекс nanostores:
 * - stores
 * - subscribers (компоненты/хуки/эффекты, которые читают stores)
 * - relations (declares / subscribes_to / derives_from)
 *
 * Использует ts-morph для точного AST-анализа вместо регулярных выражений.
 *
 * Результат кэшируется на CACHE_TTL_MS (30 сек по умолчанию).
 * Используйте options.force = true для принудительного пересканирования.
 */
export async function scanProject(
	rootDir: string,
	options: ScanOptions = {},
): Promise<ProjectIndex> {
	const { force = false, cacheTtlMs = CACHE_TTL_MS, onProgress } = options;
	const absRoot = path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir);

	// Проверяем кэш
	if (!force) {
		const cached = projectIndexCache.get(absRoot);
		if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
			onProgress?.(1, 1, "Using cached index");
			return cached.index;
		}
	}

	const stat = await fs.stat(absRoot);
	if (!stat.isDirectory()) {
		throw new Error(`Provided root is not a directory: ${absRoot}`);
	}

	// Инициализация ts-morph проекта
	const project = new Project({
		skipAddingFilesFromTsConfig: true,
		compilerOptions: {
			allowJs: true,
			jsx: 1, // Preserve
		},
	});

	// Собираем список файлов для анализа
	onProgress?.(0, 4, "Walking directory tree");
	const patterns = SOURCE_EXTENSIONS.map(ext => `**/*.${ext}`);
	const files = await globby(patterns, {
		cwd: absRoot,
		absolute: true,
		gitignore: true,
		ignore: ["**/node_modules/**", "**/.git/**"],
	});

	// Добавляем файлы в ts-morph проект
	onProgress?.(1, 4, `Loading ${files.length} source files`);
	for (const filePath of files) {
		try {
			project.addSourceFileAtPath(filePath);
		} catch {
			// Пропускаем файлы с синтаксическими ошибками
			continue;
		}
	}

	onProgress?.(2, 4, "Analyzing AST for stores and subscribers");

	const stores: StoreMatch[] = [];
	const subscribers: SubscriberMatch[] = [];
	const relations: StoreRelation[] = [];

	// storeName -> StoreMatch[]
	const storesByName = new Map<string, StoreMatch[]>();
	const derivedStubs: DerivedStub[] = [];

	// Nanostores функции-конструкторы
	const STORE_CREATORS = new Set([
		"atom",
		"map",
		"computed",
		"persistentAtom",
		"persistentMap",
		"atomFamily",
		"mapTemplate",
		"computedTemplate",
	]);

	// --- Первый проход: находим stores через AST ---
	for (const sourceFile of project.getSourceFiles()) {
		const absPath = sourceFile.getFilePath();
		const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

		// Находим все variable declarations
		const variableStatements = sourceFile.getVariableStatements();

		for (const statement of variableStatements) {
			for (const declaration of statement.getDeclarations()) {
				const initializer = declaration.getInitializer();
				if (!initializer) continue;

				// Проверяем, является ли инициализатор вызовом функции
				if (initializer.getKind() === SyntaxKind.CallExpression) {
					const callExpr = initializer.asKindOrThrow(SyntaxKind.CallExpression);
					const expression = callExpr.getExpression();

					// Получаем имя вызываемой функции
					let functionName: string | undefined;
					if (expression.getKind() === SyntaxKind.Identifier) {
						functionName = expression.getText();
					}

					// Проверяем, что это один из конструкторов nanostores
					if (functionName && STORE_CREATORS.has(functionName)) {
						const varName = declaration.getName();
						const kind = normalizeStoreKind(functionName);
						const line = declaration.getStartLineNumber();

						const id = `store:${relativeFile}#${varName}`;

						const store: StoreMatch = {
							id,
							file: relativeFile,
							line,
							kind,
							name: varName,
						};
						stores.push(store);

						const byName = storesByName.get(varName) ?? [];
						byName.push(store);
						storesByName.set(varName, byName);

						// file -> store relation
						relations.push({
							type: "declares",
							from: `file:${relativeFile}`,
							to: id,
							file: relativeFile,
							line,
						});

						// Для derived stores находим зависимости
						if (isDerivedKind(kind)) {
							// Анализируем аргументы вызова
							const args = callExpr.getArguments();
							for (const arg of args) {
								// Находим все identifier-ы в аргументах
								const identifiers = arg.getDescendantsOfKind(SyntaxKind.Identifier);
								for (const identifier of identifiers) {
									const depName = identifier.getText();
									// Пропускаем сам derived store
									if (depName === varName) continue;

									// Проверяем, что это похоже на имя стора
									if (storesByName.has(depName) || depName.startsWith("$")) {
										derivedStubs.push({
											derivedVar: varName,
											dependsOnVar: depName,
											file: relativeFile,
											line,
										});
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// --- Второй проход: находим подписчиков (subscribers) через AST ---
	for (const sourceFile of project.getSourceFiles()) {
		const absPath = sourceFile.getFilePath();
		const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

		const storeIds = new Set<string>();
		let firstUseLine: number | undefined;

		// Находим все вызовы useStore
		const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		for (const callExpr of callExpressions) {
			const expression = callExpr.getExpression();

			// Проверяем, что вызывается useStore
			if (expression.getKind() === SyntaxKind.Identifier) {
				const functionName = expression.getText();

				if (functionName === "useStore") {
					const args = callExpr.getArguments();
					if (args.length > 0) {
						const firstArg = args[0];

						// Получаем имя стора из первого аргумента
						if (firstArg.getKind() === SyntaxKind.Identifier) {
							const storeVarName = firstArg.getText();
							const matches = storesByName.get(storeVarName) ?? [];

							for (const store of matches) {
								storeIds.add(store.id);
							}

							if (matches.length > 0 && firstUseLine === undefined) {
								firstUseLine = callExpr.getStartLineNumber();
							}
						}
					}
				}
			}
		}

		// Создаем subscriber если найдены использования
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

	onProgress?.(3, 4, "Building relations graph");

	const result: ProjectIndex = {
		rootDir: absRoot,
		filesScanned: files.length,
		stores,
		subscribers,
		relations,
	};

	// Сохраняем в кэш
	projectIndexCache.set(absRoot, {
		index: result,
		timestamp: Date.now(),
	});

	onProgress?.(4, 4, "Scan complete");

	return result;
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
