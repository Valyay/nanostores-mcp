import path from "node:path";
import { SyntaxKind, type SourceFile } from "ts-morph";
import type { ProjectIndex, StoreMatch } from "../types.js";
import { getSymbolKey } from "./stores.js";

interface ImperativeReadContext {
	storesByName: Map<string, StoreMatch[]>;
	storesBySymbol: Map<string, StoreMatch[]>;
}

/**
 * Scans a source file for $store.get() calls and collects store IDs into imperativeGetIds.
 * Used during the mutation pass to track imperative (non-reactive) reads.
 */
export function analyzeImperativeReadsInFile(
	sourceFile: SourceFile,
	absRoot: string,
	context: ImperativeReadContext,
	imperativeGetIds: Set<string>,
): void {
	const absPath = sourceFile.getFilePath();
	const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

	for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
		const expr = callExpr.getExpression();
		if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

		const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
		if (propAccess.getName() !== "get") continue;

		const receiver = propAccess.getExpression();
		if (receiver.getKind() !== SyntaxKind.Identifier) continue;

		const identifier = receiver.asKindOrThrow(SyntaxKind.Identifier);

		// Symbol-first resolution
		const sym = identifier.getSymbol();
		if (sym) {
			const key = getSymbolKey(sym);
			const matches = context.storesBySymbol.get(key);
			if (matches && matches.length > 0) {
				for (const store of matches) imperativeGetIds.add(store.id);
				continue;
			}
		}

		// Name fallback
		const varName = identifier.getText();
		const byName = context.storesByName.get(varName) ?? [];
		if (byName.length === 1) {
			imperativeGetIds.add(byName[0].id);
		} else if (byName.length > 1) {
			const sameFile = byName.filter(s => s.file === relativeFile);
			const candidates = sameFile.length > 0 ? sameFile : byName;
			for (const store of candidates) imperativeGetIds.add(store.id);
		}
	}
}

/** Returns true if the file path looks like a test or story file. */
function isTestOrStoryFile(file: string): boolean {
	return /\.(stories|test|spec)\.[^.]+$/.test(file) ||
		/(^|[/\\])(__tests__|stories|storybook)[/\\]/i.test(file);
}

/**
 * Computes cross-pass imperative usage flags from a completed project index.
 * Mutates store.flags in-place.
 *
 * Flags set here require data from multiple scan passes (stores + subscribers + mutators),
 * so they cannot be set during individual file scans.
 */
export function computeImperativeFlags(
	index: ProjectIndex,
	imperativeGetIds: ReadonlySet<string> = new Set(),
): void {
	// Collect store IDs that have at least one reactive subscriber
	const subscribedStoreIds = new Set<string>();
	for (const rel of index.relations) {
		if (rel.type === "subscribes_to") {
			subscribedStoreIds.add(rel.to);
		}
	}

	// Collect store IDs that have at least one mutator
	const mutatedStoreIds = new Set<string>();
	for (const rel of index.relations) {
		if (rel.type === "mutates") {
			mutatedStoreIds.add(rel.to);
		}
	}

	// Stores that are reactive sources for computed stores (derives_from edge points to them).
	// These are not dead — they drive reactive computation even without direct subscribers.
	const derivedSourceIds = new Set<string>();
	for (const rel of index.relations) {
		if (rel.type === "derives_from") {
			derivedSourceIds.add(rel.to);
		}
	}

	// Build map: storeId → set of mutator files (O(mutators) pre-index to avoid O(relations×mutators) lookup)
	const mutatorById = new Map(index.mutators.map(m => [m.id, m]));
	const mutatorFilesByStore = new Map<string, Set<string>>();
	for (const rel of index.relations) {
		if (rel.type !== "mutates") continue;
		const mutator = mutatorById.get(rel.from);
		if (!mutator) continue;
		const files = mutatorFilesByStore.get(rel.to) ?? new Set<string>();
		files.add(mutator.file);
		mutatorFilesByStore.set(rel.to, files);
	}

	for (const store of index.stores) {
		const flags = store.flags ?? {};

		const mutatorFiles = mutatorFilesByStore.get(store.id);
		const isTestOnly = !!(mutatorFiles && mutatorFiles.size > 0 && [...mutatorFiles].every(isTestOrStoryFile));

		if (isTestOnly) {
			flags.storyOrTestOnlyWriter = true;
		}

		if (
			mutatedStoreIds.has(store.id) &&
			!subscribedStoreIds.has(store.id) &&
			!derivedSourceIds.has(store.id) &&
			!isTestOnly  // storyOrTestOnlyWriter fully explains the absence of subscribers
		) {
			flags.writtenWithoutSubscribers = true;
		}

		if (imperativeGetIds.has(store.id) && !subscribedStoreIds.has(store.id)) {
			flags.readViaGetOnly = true;
		}

		if (Object.keys(flags).length > 0) {
			store.flags = flags;
		}
	}
}
