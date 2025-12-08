import path from "node:path";
import {
	Project,
	SyntaxKind,
	SourceFile,
	CallExpression,
	Node,
	Symbol as TsSymbol,
} from "ts-morph";
import { globby } from "globby";
import { isErrnoException, realpathSafe } from "../config/security.js";
import fs from "node:fs/promises";
import { JsxEmit } from "typescript";

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
	derivedSymbolKey?: string;
	dependsOnSymbolKey?: string;
}

interface SubscriberContainerInfo {
	containerName?: string;
	containerStartLine: number;
}

interface SubscriberAccumulator {
	storeIds: Set<string>;
	firstUseLine?: number;
	kind: SubscriberKind;
	name?: string;
	containerStartLine: number;
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
		const absRoot = realpathSafe(
			path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir),
		);
		projectIndexCache.delete(absRoot);
	} else {
		projectIndexCache.clear();
	}
}

/**
 * Набор модулей, из которых считаем импорты nanostores-сто́ров.
 * Можно расширить в рантайме: NANOSTORES_BASE_MODULES.add("my-nanostores-wrapper")
 */
export const NANOSTORES_BASE_MODULES = new Set<string>(["nanostores", "@nanostores/core"]);

export const NANOSTORES_PERSISTENT_MODULES = new Set<string>([
	"@nanostores/persistent",
	"nanostores/persistent",
]);

/**
 * Модули, из которых считаем useStore() nanostores/react.
 * Можно расширить при необходимости (например, для своих врапперов).
 */
export const NANOSTORES_REACT_MODULES = new Set<string>(["nanostores/react", "@nanostores/react"]);

interface NanostoresStoreImports {
	storeFactories: Map<string, StoreKind>;
	nanostoresNamespaces: Set<string>;
}

/**
 * Собираем информацию об импортированных фабриках сто́ров nanostores в файле:
 * - storeFactories: локальное имя → StoreKind
 * - nanostoresNamespaces: локальные имена namespace-импортов (import * as ns from "nanostores")
 */
function collectNanostoresStoreImports(sourceFile: SourceFile): NanostoresStoreImports {
	const storeFactories = new Map<string, StoreKind>();
	const nanostoresNamespaces = new Set<string>();

	for (const imp of sourceFile.getImportDeclarations()) {
		const module = imp.getModuleSpecifierValue();

		// Основной модуль сто́ров
		const isBaseModule = NANOSTORES_BASE_MODULES.has(module);

		// Модуль persistent-сто́ров
		const isPersistentModule = NANOSTORES_PERSISTENT_MODULES.has(module);

		if (!isBaseModule && !isPersistentModule) continue;

		// Именованные импорты: atom, map, computed, persistentAtom, ...
		for (const named of imp.getNamedImports()) {
			const importedName = named.getName();
			const localName = named.getAliasNode()?.getText() ?? importedName;
			const kind = normalizeStoreKind(importedName);

			if (kind !== "unknown") {
				storeFactories.set(localName, kind);
			}
		}

		// namespace-импорты: import * as ns from "nanostores"
		if (isBaseModule) {
			const ns = imp.getNamespaceImport();
			if (ns) {
				nanostoresNamespaces.add(ns.getText());
			}
		}
	}

	return { storeFactories, nanostoresNamespaces };
}

/**
 * Определяем StoreKind из вызова функции, учитывая:
 * - алиасы: import { atom as createAtom } from "nanostores"
 * - namespace: import * as ns from "nanostores"; ns.atom(...)
 */
function getStoreKindFromCall(
	callExpr: CallExpression,
	importsInfo: NanostoresStoreImports,
): StoreKind | undefined {
	const expression = callExpr.getExpression();

	// createAtom(...)
	if (expression.getKind() === SyntaxKind.Identifier) {
		const localName = expression.getText();
		const kind = importsInfo.storeFactories.get(localName);
		return kind;
	}

	// ns.atom(...)
	if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
		const propAccess = expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
		const nsName = propAccess.getExpression().getText();
		const methodName = propAccess.getName();

		if (importsInfo.nanostoresNamespaces.has(nsName)) {
			return normalizeStoreKind(methodName);
		}
	}

	return undefined;
}

interface NanostoresReactImports {
	useStoreFns: Set<string>;
	reactNamespaces: Set<string>;
}

/**
 * Собираем информацию об импортированном useStore из nanostores/react:
 * - useStoreFns: локальные имена функций (useStore, useNanoStore, ...)
 * - reactNamespaces: namespace-импорты (import * as nsReact from "nanostores/react")
 */
function collectNanostoresReactImports(sourceFile: SourceFile): NanostoresReactImports {
	const useStoreFns = new Set<string>();
	const reactNamespaces = new Set<string>();

	for (const imp of sourceFile.getImportDeclarations()) {
		const module = imp.getModuleSpecifierValue();

		if (!NANOSTORES_REACT_MODULES.has(module)) {
			continue;
		}

		// import { useStore, useStore as useNanoStore } from "nanostores/react"
		for (const named of imp.getNamedImports()) {
			const imported = named.getName();
			const local = named.getAliasNode()?.getText() ?? imported;
			if (imported === "useStore") {
				useStoreFns.add(local);
			}
		}

		// import * as nsReact from "nanostores/react"
		const ns = imp.getNamespaceImport();
		if (ns) {
			reactNamespaces.add(ns.getText());
		}
	}

	return { useStoreFns, reactNamespaces };
}

/**
 * Проверяем, что вызов — это именно useStore из nanostores/react:
 * - useStore(...) или useNanoStore(...)
 * - nsReact.useStore(...)
 */
function isUseStoreCall(callExpr: CallExpression, imports: NanostoresReactImports): boolean {
	const expr = callExpr.getExpression();

	// useStore(...)
	if (expr.getKind() === SyntaxKind.Identifier) {
		const fnName = expr.getText();
		return imports.useStoreFns.has(fnName);
	}

	// nsReact.useStore(...)
	if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
		const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
		const objName = propAccess.getExpression().getText();
		const propName = propAccess.getName();

		return imports.reactNamespaces.has(objName) && propName === "useStore";
	}

	return false;
}

function findSubscriberContainerInfo(callExpr: CallExpression): SubscriberContainerInfo {
	let node: Node | undefined = callExpr;

	while (node && !Node.isSourceFile(node)) {
		// function Counter() { ... }
		if (Node.isFunctionDeclaration(node)) {
			const name = node.getName() ?? undefined;
			const startLine = node.getNameNode()?.getStartLineNumber() ?? node.getStartLineNumber();
			return {
				containerName: name,
				containerStartLine: startLine,
			};
		}

		// const Counter = () => { ... }
		// const useCounter = function () { ... }
		if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
			const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);

			if (varDecl) {
				const name = varDecl.getName();
				return {
					containerName: name,
					containerStartLine: varDecl.getStartLineNumber(),
				};
			}

			// анонимная функция без переменной — считаем подписчиком саму функцию
			return {
				containerName: undefined,
				containerStartLine: node.getStartLineNumber(),
			};
		}

		// class Counter { render() { useStore(...) } }
		if (Node.isMethodDeclaration(node)) {
			const methodName = node.getName();
			const classDecl = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
			const className = classDecl?.getName();

			const name = className && methodName ? `${className}.${methodName}` : methodName || className;

			return {
				containerName: name,
				containerStartLine: node.getStartLineNumber(),
			};
		}

		// useStore прямо в теле класса
		if (Node.isClassDeclaration(node)) {
			const name = node.getName();
			if (name) {
				return {
					containerName: name,
					containerStartLine: node.getStartLineNumber(),
				};
			}
		}

		node = node.getParent();
	}

	// Фоллбек: считаем подписчиком сам файл/тело
	return {
		containerName: undefined,
		containerStartLine: callExpr.getStartLineNumber(),
	};
}

function getSymbolKey(symbol: TsSymbol): string {
	const decl = (symbol.getDeclarations()[0] ?? undefined) as Node | undefined;
	if (decl) {
		const filePath = decl.getSourceFile().getFilePath();
		const line = decl.getStartLineNumber();
		return `${symbol.getName()}@${filePath}:${line}`;
	}
	return symbol.getName();
}

function makeRelationKey(rel: StoreRelation): string {
	// file и line могут быть undefined — нормализуем в строку,
	// чтобы ключ был детерминированный.
	const filePart = rel.file ?? "";
	const linePart = rel.line != null ? String(rel.line) : "";
	return `${rel.type}|${rel.from}|${rel.to}|${filePart}|${linePart}`;
}

function addRelation(
	rel: StoreRelation,
	relations: StoreRelation[],
	relationKeys: Set<string>,
): void {
	const key = makeRelationKey(rel);
	if (relationKeys.has(key)) return;
	relationKeys.add(key);
	relations.push(rel);
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
	const absRoot = realpathSafe(
		path.isAbsolute(rootDir) ? rootDir : path.resolve(process.cwd(), rootDir),
	);

	if (!force) {
		const cached = projectIndexCache.get(absRoot);
		if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
			onProgress?.(1, 1, "Using cached index");
			return cached.index;
		}
	}

	onProgress?.(0, 4, `Validating workspace root: ${absRoot}`);

	// Инициализация ts-morph проекта
	const project = new Project({
		skipAddingFilesFromTsConfig: true,
		compilerOptions: {
			allowJs: true,
			jsx: JsxEmit.Preserve,
		},
	});

	// Собираем список файлов для анализа с помощью globby
	// Используем brace expansion для компактной записи всех расширений
	// globby автоматически обработает несуществующие директории и .gitignore
	onProgress?.(0, 4, "Scanning source files");

	try {
		const stat = await fs.stat(absRoot);
		if (!stat.isDirectory()) {
			throw new Error(`Provided root is not a directory: ${absRoot}`);
		}
	} catch (err) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			throw new Error(`Workspace root does not exist: ${absRoot}`);
		}
		throw err;
	}

	const files = await globby("**/*.{ts,tsx,js,jsx,mjs,cjs}", {
		cwd: absRoot,
		absolute: true,
		gitignore: true,
		onlyFiles: true,
		// В реальных проектах сильно снижает шум и время сканирования
		ignore: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.next/**",
			"**/.turbo/**",
			"**/coverage/**",
		],
	});

	onProgress?.(1, 4, `Found ${files.length} candidate source files`);

	let loadedFiles = 0;
	let skippedFiles = 0;
	const parseErrorFiles: string[] = [];

	for (const filePath of files) {
		try {
			project.addSourceFileAtPath(filePath);
			loadedFiles += 1;
		} catch {
			// Пропускаем файлы с синтаксическими ошибками, но считаем их и даём пример имён
			skippedFiles += 1;
			if (parseErrorFiles.length < 5) {
				const relativeFile = path.relative(absRoot, filePath) || path.basename(filePath);
				parseErrorFiles.push(relativeFile);
			}
			continue;
		}
	}

	if (skippedFiles > 0) {
		const examples = parseErrorFiles.length > 0 ? ` (examples: ${parseErrorFiles.join(", ")})` : "";
		onProgress?.(
			1,
			4,
			`Loaded ${loadedFiles} files, skipped ${skippedFiles} files with parse errors${examples}`,
		);
	} else {
		onProgress?.(1, 4, `Loaded ${loadedFiles} source files without parse errors`);
	}

	onProgress?.(2, 4, "Analyzing AST for stores and subscribers");

	const stores: StoreMatch[] = [];
	const subscribers: SubscriberMatch[] = [];
	const relations: StoreRelation[] = [];
	const relationKeys = new Set<string>();

	// storeName -> StoreMatch[]
	const storesByName = new Map<string, StoreMatch[]>();
	// символ (в виде строки) -> StoreMatch[]
	const storesBySymbol = new Map<string, StoreMatch[]>();
	const derivedStubs: DerivedStub[] = [];

	// --- Первый проход: находим stores через AST ---
	for (const sourceFile of project.getSourceFiles()) {
		const absPath = sourceFile.getFilePath();
		const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

		// Собираем информацию о том, какие фабрики сто́ров импортированы в этом файле
		const importsInfo = collectNanostoresStoreImports(sourceFile);

		// Находим все variable declarations
		const variableStatements = sourceFile.getVariableStatements();

		for (const statement of variableStatements) {
			for (const declaration of statement.getDeclarations()) {
				const initializer = declaration.getInitializer();
				if (!initializer || initializer.getKind() !== SyntaxKind.CallExpression) continue;

				const callExpr = initializer.asKindOrThrow(SyntaxKind.CallExpression);

				// Определяем StoreKind по реальным импортам nanostores
				const kind = getStoreKindFromCall(callExpr, importsInfo);
				if (!kind) continue;

				const varName = declaration.getName();
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

				let storeSymbolKey: string | undefined;
				const nameNode = (declaration as { getNameNode?: () => Node }).getNameNode?.() as
					| Node
					| undefined;
				const symbol = nameNode?.getSymbol();
				if (symbol) {
					storeSymbolKey = getSymbolKey(symbol);
					const bySymbol = storesBySymbol.get(storeSymbolKey) ?? [];
					bySymbol.push(store);
					storesBySymbol.set(storeSymbolKey, bySymbol);
				}

				// file -> store relation
				addRelation(
					{
						type: "declares",
						from: `file:${relativeFile}`,
						to: id,
						file: relativeFile,
						line,
					},
					relations,
					relationKeys,
				);

				// Для derived stores находим зависимости по первому аргументу
				if (isDerivedKind(kind)) {
					const [depsArg] = callExpr.getArguments();
					if (!depsArg) {
						// computed() без deps — странно, пропускаем
					} else {
						type DepCandidate = { name: string; symbolKey?: string };
						const depCandidates: DepCandidate[] = [];

						// computed(counter, ...)
						if (depsArg.getKind() === SyntaxKind.Identifier) {
							const ident = depsArg.asKindOrThrow(SyntaxKind.Identifier);
							const name = ident.getText();
							const sym = ident.getSymbol();
							depCandidates.push({
								name,
								symbolKey: sym ? getSymbolKey(sym) : undefined,
							});
						}

						// computed([a, b], ...)
						if (depsArg.getKind() === SyntaxKind.ArrayLiteralExpression) {
							const arr = depsArg.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
							for (const el of arr.getElements()) {
								if (el.getKind() === SyntaxKind.Identifier) {
									const ident = el.asKindOrThrow(SyntaxKind.Identifier);
									const name = ident.getText();
									const sym = ident.getSymbol();
									depCandidates.push({
										name,
										symbolKey: sym ? getSymbolKey(sym) : undefined,
									});
								}
							}
						}

						// Убираем дубли по имени
						const unique = new Map<string, string | undefined>();
						for (const { name, symbolKey } of depCandidates) {
							if (!unique.has(name)) unique.set(name, symbolKey);
						}

						for (const [depName, depSymbolKey] of unique) {
							if (depName === varName) continue;

							derivedStubs.push({
								derivedVar: varName,
								dependsOnVar: depName,
								file: relativeFile,
								line,
								derivedSymbolKey: storeSymbolKey,
								dependsOnSymbolKey: depSymbolKey,
							});
						}
					}
				}
			}
		}
	}

	onProgress?.(2, 4, `AST analysis complete: found ${stores.length} stores so far`);

	// --- Второй проход: находим подписчиков (subscribers) через AST ---
	for (const sourceFile of project.getSourceFiles()) {
		const absPath = sourceFile.getFilePath();
		const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

		// Собираем информацию о useStore из nanostores/react
		const reactImports = collectNanostoresReactImports(sourceFile);

		const subscriberAccumulators = new Map<string, SubscriberAccumulator>();

		const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		for (const callExpr of callExpressions) {
			// Проверяем, что это вызов именно useStore из nanostores/react
			if (!isUseStoreCall(callExpr, reactImports)) continue;

			const args = callExpr.getArguments();
			if (!args[0] || args[0].getKind() !== SyntaxKind.Identifier) continue;

			const firstArg = args[0].asKindOrThrow(SyntaxKind.Identifier);

			let matches: StoreMatch[] = [];
			const sym = firstArg.getSymbol();

			if (sym) {
				const key = getSymbolKey(sym);
				matches = storesBySymbol.get(key) ?? [];
			}

			// fallback по имени, если символов нет (JS, неполный типчек и т.п.)
			// Делаем его максимально консервативным, чтобы не плодить ложные связи:
			// 1) если есть ровно один store с таким именем — используем его;
			// 2) если store-ов с таким именем несколько, но ровно один в текущем файле — берём его;
			// 3) во всех остальных случаях связи не создаём (matches остаётся пустым).
			if (matches.length === 0) {
				const storeVarName = firstArg.getText();
				const byName = storesByName.get(storeVarName) ?? [];

				if (byName.length === 1) {
					matches = byName;
				} else if (byName.length > 1) {
					const sameFile = byName.filter(s => s.file === relativeFile);
					if (sameFile.length === 1) {
						matches = sameFile;
					}
				}
			}

			if (matches.length === 0) {
				// Не смогли однозначно сопоставить useStore(...) с конкретным store'ом — пропускаем
				continue;
			}

			// Определяем, внутри какого компонента/хука/класса находится вызов
			const { containerName, containerStartLine } = findSubscriberContainerInfo(callExpr);
			const containerKeyName = containerName ?? `__anon_${containerStartLine}`;
			const key = `${relativeFile}::${containerKeyName}`;

			let acc = subscriberAccumulators.get(key);
			if (!acc) {
				const kind = inferSubscriberKind(relativeFile, containerName);
				acc = {
					storeIds: new Set<string>(),
					firstUseLine: callExpr.getStartLineNumber(),
					kind,
					name: containerName,
					containerStartLine,
				};
				subscriberAccumulators.set(key, acc);
			}

			for (const store of matches) {
				acc.storeIds.add(store.id);
			}

			const callLine = callExpr.getStartLineNumber();
			if (acc.firstUseLine === undefined || callLine < acc.firstUseLine) {
				acc.firstUseLine = callLine;
			}
		}

		// Создаём SubscriberMatch для каждого контейнера, где есть подписки
		for (const acc of subscriberAccumulators.values()) {
			const storeIds = Array.from(acc.storeIds);
			if (storeIds.length === 0) continue;

			const hasName = !!acc.name;
			const subscriberId = hasName
				? `subscriber:${relativeFile}#${acc.name}`
				: `subscriber:${relativeFile}@${acc.containerStartLine}`;

			const name = acc.name ?? path.basename(relativeFile, path.extname(relativeFile));
			const line = acc.firstUseLine ?? acc.containerStartLine;

			const subscriber: SubscriberMatch = {
				id: subscriberId,
				file: relativeFile,
				line,
				kind: acc.kind,
				name,
				storeIds,
			};

			subscribers.push(subscriber);

			// file -> subscriber relation (declares)
			addRelation(
				{
					type: "declares",
					from: `file:${relativeFile}`,
					to: subscriberId,
					file: relativeFile,
					line,
				},
				relations,
				relationKeys,
			);

			for (const storeId of storeIds) {
				addRelation(
					{
						type: "subscribes_to",
						from: subscriberId,
						to: storeId,
						file: relativeFile,
						line,
					},
					relations,
					relationKeys,
				);
			}
		}
	}

	onProgress?.(
		2,
		4,
		`AST analysis complete: found ${stores.length} stores and ${subscribers.length} subscribers`,
	);

	// --- Третий проход: резолвим derived -> base (derives_from) по stub-ам ---
	for (const stub of derivedStubs) {
		let derivedMatches: StoreMatch[] = [];
		let baseMatches: StoreMatch[] = [];

		// Сначала пробуем по символам
		if (stub.derivedSymbolKey) {
			derivedMatches = storesBySymbol.get(stub.derivedSymbolKey) ?? [];
		}
		if (stub.dependsOnSymbolKey) {
			baseMatches = storesBySymbol.get(stub.dependsOnSymbolKey) ?? [];
		}

		// Fallback по имени (на случай, если символы недоступны)
		if (derivedMatches.length === 0) {
			derivedMatches = storesByName.get(stub.derivedVar) ?? [];
		}
		if (baseMatches.length === 0) {
			baseMatches = storesByName.get(stub.dependsOnVar) ?? [];
		}

		for (const derivedStore of derivedMatches) {
			for (const baseStore of baseMatches) {
				addRelation(
					{
						type: "derives_from",
						from: derivedStore.id,
						to: baseStore.id,
						file: stub.file,
						line: stub.line,
					},
					relations,
					relationKeys,
				);
			}
		}
	}

	onProgress?.(3, 4, "Building relations graph");

	const result: ProjectIndex = {
		rootDir: absRoot,
		filesScanned: loadedFiles,
		stores,
		subscribers,
		relations,
	};

	// Сохраняем в кэш
	projectIndexCache.set(absRoot, {
		index: result,
		timestamp: Date.now(),
	});

	onProgress?.(
		4,
		4,
		`Scan complete: files=${loadedFiles}/${files.length}, stores=${stores.length}, subscribers=${subscribers.length}, relations=${relations.length}`,
	);

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

/**
 * Какие StoreKind считаем "derived".
 *
 * Важно: сознательно НЕ включаем сюда atomFamily/mapTemplate,
 * пока не будет 100% уверенности в их семантике зависимостей.
 * Это уменьшает вероятность фальшивых derives_from связей.
 */
function isDerivedKind(kind: StoreKind): boolean {
	return kind === "computed" || kind === "computedTemplate";
}

function inferSubscriberKind(relativeFile: string, containerName?: string): SubscriberKind {
	const ext = path.extname(relativeFile);
	const base = path.basename(relativeFile, ext);
	const nameToCheck = containerName ?? base;

	if (nameToCheck.startsWith("use")) {
		return "hook";
	}

	if (/effect/i.test(nameToCheck)) {
		return "effect";
	}

	if (
		/^[A-Z]/.test(nameToCheck) &&
		(ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".ts")
	) {
		return "component";
	}

	if (ext === ".tsx" || ext === ".jsx") {
		return "component";
	}

	return "unknown";
}
