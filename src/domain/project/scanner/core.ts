import path from "node:path";
import fs from "node:fs/promises";
import { Project } from "ts-morph";
import { JsxEmit, ScriptKind } from "typescript";
import { isErrnoException, realpathSafe } from "../../../config/security.js";
import { discoverSourceFiles } from "./files.js";
import type { ProjectIndex, ScanOptions } from "../types.js";
import type { StoreMatch, SubscriberMatch, StoreRelation } from "../types.js";
import { collectNanostoresStoreImports, collectNanostoresFrameworkImports } from "./imports.js";
import type { NanostoresStoreImports } from "./imports.js";
import { analyzeStoresInFile, detectMountDependentActivation } from "./stores.js";
import type { StoreAnalysisContext, DerivedStub } from "./stores.js";
import { analyzeSubscribersInFile } from "./subscribers.js";
import type { SubscriberAnalysisContext } from "./subscribers.js";
import { analyzeMutationsInFile } from "./mutations.js";
import type { MutationAnalysisContext } from "./mutations.js";
import { addRelation, resolveDerivedRelations } from "./relations.js";
import { analyzeImperativeReadsInFile, computeImperativeFlags } from "./imperativeFlags.js";
import { extractScriptsFromSvelteSfc, extractScriptsFromVueSfc } from "./sfc.js";

/**
 * Look for tsconfig.json starting in rootDir and walking up to filesystem root.
 * Returns the absolute path if found, undefined otherwise.
 */
async function findTsConfig(startDir: string): Promise<string | undefined> {
	let dir = startDir;
	while (true) {
		const candidate = path.join(dir, "tsconfig.json");
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// not found here, go up
		}
		const parent = path.dirname(dir);
		if (parent === dir) return undefined; // reached filesystem root
		dir = parent;
	}
}

/**
 * Internal extension of ScanOptions that carries pre-discovered files.
 * Not exported — callers use ScanOptions; files is set only by ProjectIndexRepository
 * to avoid a redundant discoverSourceFiles() call after freshness checking.
 */
type ScanProjectOptions = ScanOptions & { files?: string[] };

/**
 * Scan a project and build a nanostores index:
 * - stores
 * - subscribers (components/hooks/effects that read stores)
 * - relations (declares / subscribes_to / derives_from)
 *
 * Uses ts-morph for precise AST analysis instead of regular expressions.
 *
 * NOTE: This function is now pure and does not cache results.
 * Caching is handled by the ProjectIndexRepository layer.
 */
export async function scanProject(
	rootDir: string,
	options: ScanProjectOptions = {},
): Promise<ProjectIndex> {
	const { onProgress, moduleConfig } = options;
	// realpathSafe calls normalizeFsPath = path.resolve internally, so relative
	// paths are resolved against process.cwd() without an explicit isAbsolute guard.
	const absRoot = realpathSafe(rootDir);

	onProgress?.(0, 4, `Validating workspace root: ${absRoot}`);

	// Try to find tsconfig.json in the project root so that ts-morph can resolve
	// node_modules (including nanostores types) for accurate value type inference.
	const tsconfigPath = await findTsConfig(absRoot);

	// Initialize ts-morph project
	const project = new Project({
		...(tsconfigPath ? { tsConfigFilePath: tsconfigPath } : {}),
		skipAddingFilesFromTsConfig: true,
		compilerOptions: {
			allowJs: true,
			jsx: JsxEmit.Preserve,
		},
	});

	try {
		onProgress?.(0, 4, "Scanning source files");

		try {
			const stat = await fs.stat(absRoot);
			if (!stat.isDirectory()) {
				throw new Error(`Provided root is not a directory: ${absRoot}`);
			}
		} catch (err) {
			if (isErrnoException(err) && err.code === "ENOENT") {
				throw new Error(`Workspace root does not exist: ${absRoot}`, { cause: err });
			}
			throw err;
		}

		if (options.files !== undefined) {
			// Use path.relative so the check is platform-safe: globby returns forward-slash
			// paths on all platforms while path.sep / realpathSafe use OS-native separators.
			// path.relative normalises both sides before computing the relationship.
			const invalid = options.files.find(f => {
				const rel = path.relative(absRoot, f);
				return rel.startsWith("..") || path.isAbsolute(rel);
			});
			if (invalid) {
				throw new Error(`Pre-discovered file lies outside project root "${absRoot}": ${invalid}`);
			}
		}

		const files = options.files ?? (await discoverSourceFiles(absRoot));

		onProgress?.(1, 4, `Found ${files.length} candidate source files`);

		let loadedFiles = 0;
		let skippedFiles = 0;
		const parseErrorFiles: string[] = [];
		// Svelte template $varName refs, keyed by absolute file path
		const svelteTemplateRefs = new Map<string, string[]>();

		for (const filePath of files) {
			try {
				const ext = path.extname(filePath).toLowerCase();

				if (ext === ".vue" || ext === ".svelte") {
					const contents = await fs.readFile(filePath, "utf8");
					const sfcResult =
						ext === ".vue"
							? await extractScriptsFromVueSfc(contents, filePath)
							: await extractScriptsFromSvelteSfc(contents, filePath);
					const { code, scriptKind, hasScript } = sfcResult;

					if (sfcResult.templateStoreRefs && sfcResult.templateStoreRefs.length > 0) {
						svelteTemplateRefs.set(filePath, sfcResult.templateStoreRefs);
					}

					if (!hasScript) {
						project.createSourceFile(filePath, "", {
							overwrite: true,
							scriptKind: ScriptKind.JS,
						});
					} else {
						project.createSourceFile(filePath, code, { overwrite: true, scriptKind });
					}

					loadedFiles += 1;
					continue;
				}

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
			const examples =
				parseErrorFiles.length > 0 ? ` (examples: ${parseErrorFiles.join(", ")})` : "";
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
		const mutators: import("../types.js").MutatorMatch[] = [];
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

		// --- First pass: find stores (cache storeImports per file for reuse in pass 2) ---
		const storeImportsCache = new Map<import("ts-morph").SourceFile, NanostoresStoreImports>();
		for (const sourceFile of project.getSourceFiles()) {
			const importsInfo = collectNanostoresStoreImports(sourceFile, moduleConfig);
			storeImportsCache.set(sourceFile, importsInfo);
			analyzeStoresInFile(sourceFile, absRoot, importsInfo, storeContext);
			detectMountDependentActivation(sourceFile, storeContext, importsInfo.onMountFns);
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
			const frameworkImports = collectNanostoresFrameworkImports(sourceFile, moduleConfig);
			const storeImports = storeImportsCache.get(sourceFile);
			analyzeSubscribersInFile(
				sourceFile,
				absRoot,
				frameworkImports,
				subscriberContext,
				storeImports,
			);
		}

		// --- Svelte template $store auto-subscriptions ---
		for (const [filePath, refNames] of svelteTemplateRefs) {
			const relativeFile = path.relative(absRoot, filePath) || path.basename(filePath);
			const matchedStoreIds: string[] = [];

			for (const refName of refNames) {
				// Try with and without $ prefix
				const candidates = [
					...(storesByName.get(refName) ?? []),
					...(storesByName.get(`$${refName}`) ?? []),
				];
				for (const store of candidates) {
					if (!matchedStoreIds.includes(store.id)) {
						matchedStoreIds.push(store.id);
					}
				}
			}

			if (matchedStoreIds.length === 0) continue;

			const baseName = path.basename(filePath, path.extname(filePath));

			// Check if a subscriber already exists for this file (from useStore detection).
			// Match by file, not by id — useStore creates IDs like subscriber:path@line
			// while template creates subscriber:path#BaseName.
			const existing = subscribers.find(s => s.file === relativeFile);
			if (existing) {
				// Merge template store refs into existing subscriber
				for (const storeId of matchedStoreIds) {
					if (!existing.storeIds.includes(storeId)) {
						existing.storeIds.push(storeId);
						addRelation(
							{ type: "subscribes_to", from: existing.id, to: storeId, file: relativeFile },
							relations,
							relationKeys,
						);
					}
				}
			} else {
				const subscriberId = `subscriber:${relativeFile}#${baseName}`;
				// Create new subscriber for the template
				const subscriber: SubscriberMatch = {
					id: subscriberId,
					file: relativeFile,
					line: 1,
					kind: "component",
					name: baseName,
					storeIds: matchedStoreIds,
				};
				subscribers.push(subscriber);
				addRelation(
					{
						type: "declares",
						from: `file:${relativeFile}`,
						to: subscriberId,
						file: relativeFile,
						line: 1,
					},
					relations,
					relationKeys,
				);
				for (const storeId of matchedStoreIds) {
					addRelation(
						{ type: "subscribes_to", from: subscriberId, to: storeId, file: relativeFile },
						relations,
						relationKeys,
					);
				}
			}
		}

		const imperativeGetIds = new Set<string>();

		const mutationContext: MutationAnalysisContext = {
			absRoot,
			mutators,
			storesByName,
			storesBySymbol,
			relations,
			relationKeys,
		};

		// --- Third pass: find mutators + imperative .get() reads ---
		for (const sourceFile of project.getSourceFiles()) {
			analyzeMutationsInFile(sourceFile, absRoot, mutationContext);
			analyzeImperativeReadsInFile(
				sourceFile,
				absRoot,
				{ storesByName, storesBySymbol },
				imperativeGetIds,
			);
		}

		onProgress?.(
			2,
			4,
			`AST analysis complete: found ${stores.length} stores, ${subscribers.length} subscribers, ${mutators.length} mutators`,
		);

		// --- Fourth pass: resolve derived relations ---
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
			mutators,
			relations,
		};

		computeImperativeFlags(result, imperativeGetIds);

		onProgress?.(
			4,
			4,
			`Scan complete: files=${loadedFiles}/${files.length}, stores=${stores.length}, subscribers=${subscribers.length}, relations=${relations.length}`,
		);

		return result;
	} finally {
		// Release AST memory held by ts-morph
		for (const sf of project.getSourceFiles()) {
			project.removeSourceFile(sf);
		}
	}
}
