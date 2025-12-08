import path from "node:path";
import fs from "node:fs/promises";
import { Project } from "ts-morph";
import { JsxEmit } from "typescript";
import { globby } from "globby";
import { isErrnoException, realpathSafe } from "../../config/security.js";
import type { ProjectIndex, ScanOptions } from "./types.js";
import type { StoreMatch, SubscriberMatch, StoreRelation } from "./types.js";
import { collectNanostoresStoreImports, collectNanostoresReactImports } from "./imports.js";
import { analyzeStoresInFile } from "./stores.js";
import type { StoreAnalysisContext, DerivedStub } from "./stores.js";
import { analyzeSubscribersInFile } from "./subscribers.js";
import type { SubscriberAnalysisContext } from "./subscribers.js";
import { resolveDerivedRelations } from "./relations.js";

// --- Project index caching ---

interface CacheEntry {
	index: ProjectIndex;
	timestamp: number;
}

const projectIndexCache = new Map<string, CacheEntry>();

/** Cache TTL in milliseconds (default 30 seconds) */
const CACHE_TTL_MS = 30_000;

/**
 * Clear index cache for a specific root or the entire cache.
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
 * Public domain API:
 * Scan a project and build a nanostores index:
 * - stores
 * - subscribers (components/hooks/effects that read stores)
 * - relations (declares / subscribes_to / derives_from)
 *
 * Uses ts-morph for precise AST analysis instead of regular expressions.
 *
 * Result is cached for CACHE_TTL_MS (30 sec by default).
 * Use options.force = true to force rescan.
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

	// Initialize ts-morph project
	const project = new Project({
		skipAddingFilesFromTsConfig: true,
		compilerOptions: {
			allowJs: true,
			jsx: JsxEmit.Preserve,
		},
	});

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

	const storesByName = new Map<string, StoreMatch[]>();
	const storesBySymbol = new Map<string, StoreMatch[]>();
	const derivedStubs: DerivedStub[] = [];

	const storeContext: StoreAnalysisContext = {
		absRoot,
		stores,
		storesByName,
		storesBySymbol,
		derivedStubs,
		relations,
		relationKeys,
	};

	// --- First pass: find stores ---
	for (const sourceFile of project.getSourceFiles()) {
		const importsInfo = collectNanostoresStoreImports(sourceFile);
		analyzeStoresInFile(sourceFile, absRoot, importsInfo, storeContext);
	}

	onProgress?.(2, 4, `AST analysis complete: found ${stores.length} stores so far`);

	const subscriberContext: SubscriberAnalysisContext = {
		absRoot,
		subscribers,
		storesByName,
		storesBySymbol,
		relations,
		relationKeys,
	};

	// --- Second pass: find subscribers ---
	for (const sourceFile of project.getSourceFiles()) {
		const reactImports = collectNanostoresReactImports(sourceFile);
		analyzeSubscribersInFile(sourceFile, absRoot, reactImports, subscriberContext);
	}

	onProgress?.(
		2,
		4,
		`AST analysis complete: found ${stores.length} stores and ${subscribers.length} subscribers`,
	);

	// --- Third pass: resolve derived relations ---
	onProgress?.(3, 4, "Building relations graph");

	resolveDerivedRelations(derivedStubs, {
		storesByName,
		storesBySymbol,
		relations,
		relationKeys,
	});

	const result: ProjectIndex = {
		rootDir: absRoot,
		filesScanned: loadedFiles,
		stores,
		subscribers,
		relations,
	};

	// Save to cache
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
