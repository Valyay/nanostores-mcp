import { CallExpression, SyntaxKind, SourceFile, Node } from "ts-morph";
import path from "node:path";
import type { MutatorMatch, MutatorKind, StoreMatch, StoreRelation } from "../types.js";
import { getSymbolKey } from "./stores.js";
import { addRelation } from "./relations.js";

/** Method names on store objects that count as writes/mutations. */
const MUTATION_METHODS = new Set(["set", "setKey"]);

const SFC_EXTENSIONS = new Set([".vue", ".svelte"]);

function isSfcFile(filePath: string): boolean {
	return SFC_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export interface MutationAnalysisContext {
	absRoot: string;
	mutators: MutatorMatch[];
	storesByName: Map<string, StoreMatch[]>;
	storesBySymbol: Map<string, StoreMatch[]>;
	relations: StoreRelation[];
	relationKeys: Set<string>;
}

interface MutatorAccumulator {
	storeIds: Set<string>;
	firstMutationLine?: number;
	kind: MutatorKind;
	name?: string;
	containerStartLine: number;
}

/**
 * If `callExpr` is `$store.set(...)`, `$store.setKey(...)`, etc.,
 * try to resolve the receiver to a known store.
 */
function tryResolveMutation(
	callExpr: CallExpression,
	context: Pick<MutationAnalysisContext, "storesBySymbol" | "storesByName">,
	relativeFile: string,
): StoreMatch[] {
	const expr = callExpr.getExpression();
	if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return [];

	const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
	const methodName = propAccess.getName();
	if (!MUTATION_METHODS.has(methodName)) return [];

	const receiver = propAccess.getExpression();
	if (receiver.getKind() !== SyntaxKind.Identifier) return [];

	const identifier = receiver.asKindOrThrow(SyntaxKind.Identifier);

	// Symbol-first resolution
	const sym = identifier.getSymbol();
	if (sym) {
		const key = getSymbolKey(sym);
		const matches = context.storesBySymbol.get(key);
		if (matches && matches.length > 0) return matches;
	}

	// Name fallback
	const varName = identifier.getText();
	const byName = context.storesByName.get(varName) ?? [];

	if (byName.length === 1) return byName;

	if (byName.length > 1) {
		const sameFile = byName.filter(s => s.file === relativeFile);
		if (sameFile.length === 1) return sameFile;
		if (isSfcFile(relativeFile)) return byName;
	}

	return [];
}

function findMutatorContainerInfo(
	callExpr: CallExpression,
): { containerName?: string; containerStartLine: number } {
	let node: Node | undefined = callExpr;

	while (node && !Node.isSourceFile(node)) {
		if (Node.isFunctionDeclaration(node)) {
			const name = node.getName() ?? undefined;
			const startLine = node.getNameNode()?.getStartLineNumber() ?? node.getStartLineNumber();
			return { containerName: name, containerStartLine: startLine };
		}

		if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
			const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
			if (varDecl) {
				return { containerName: varDecl.getName(), containerStartLine: varDecl.getStartLineNumber() };
			}
			return { containerName: undefined, containerStartLine: node.getStartLineNumber() };
		}

		if (Node.isMethodDeclaration(node)) {
			const methodName = node.getName();
			const classDecl = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
			const className = classDecl?.getName();
			const name =
				className && methodName ? `${className}.${methodName}` : methodName || className;
			return { containerName: name, containerStartLine: node.getStartLineNumber() };
		}

		if (Node.isClassDeclaration(node)) {
			const name = node.getName();
			if (name) return { containerName: name, containerStartLine: node.getStartLineNumber() };
		}

		node = node.getParent();
	}

	return { containerName: undefined, containerStartLine: callExpr.getStartLineNumber() };
}

export function inferMutatorKind(relativeFile: string, containerName?: string): MutatorKind {
	const ext = path.extname(relativeFile);
	const base = path.basename(relativeFile, ext);
	const nameToCheck = containerName ?? base;

	// Match "action" / "actions" only as a whole segment in the file path
	// (e.g. src/actions/auth.ts, user.actions.ts).
	// Splitting on both path separators AND dots catches "user.actions.ts" reliably
	// while avoiding false positives from words like "transactions".
	const isActionFile = relativeFile
		.split(/[/\\]/)
		.some(segment => segment.split(".").some(part => /^actions?$/i.test(part)));

	if (isActionFile) {
		return "action";
	}

	if (/effect/i.test(nameToCheck)) {
		return "effect";
	}

	// heuristic: names with a dot are class methods (ClassName.methodName)
	if (nameToCheck.includes(".")) return "method";

	if (containerName) return "function";

	return "unknown";
}

/**
 * Analyzes source file and finds all store mutations.
 */
export function analyzeMutationsInFile(
	sourceFile: SourceFile,
	absRoot: string,
	context: MutationAnalysisContext,
): void {
	const absPath = sourceFile.getFilePath();
	const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

	const accumulators = new Map<string, MutatorAccumulator>();

	const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

	for (const callExpr of callExpressions) {
		const matches = tryResolveMutation(callExpr, context, relativeFile);
		if (matches.length === 0) continue;

		const { containerName, containerStartLine } = findMutatorContainerInfo(callExpr);
		const containerKeyName = containerName ?? `__anon_${containerStartLine}`;
		const key = `${relativeFile}::${containerKeyName}`;

		let acc = accumulators.get(key);
		if (!acc) {
			const kind = inferMutatorKind(relativeFile, containerName);
			acc = {
				storeIds: new Set<string>(),
				firstMutationLine: callExpr.getStartLineNumber(),
				kind,
				name: containerName,
				containerStartLine,
			};
			accumulators.set(key, acc);
		}

		for (const store of matches) {
			acc.storeIds.add(store.id);
		}

		const callLine = callExpr.getStartLineNumber();
		if (acc.firstMutationLine === undefined || callLine < acc.firstMutationLine) {
			acc.firstMutationLine = callLine;
		}
	}

	for (const acc of accumulators.values()) {
		const storeIds = Array.from(acc.storeIds);
		if (storeIds.length === 0) continue;

		const hasName = !!acc.name;
		const mutatorId = hasName
			? `mutator:${relativeFile}#${acc.name}`
			: `mutator:${relativeFile}@${acc.containerStartLine}`;

		const name = acc.name ?? path.basename(relativeFile, path.extname(relativeFile));
		const line = acc.firstMutationLine ?? acc.containerStartLine;

		const mutator: MutatorMatch = {
			id: mutatorId,
			file: relativeFile,
			line,
			kind: acc.kind,
			name,
			storeIds,
		};

		context.mutators.push(mutator);

		for (const storeId of storeIds) {
			addRelation(
				{
					type: "mutates",
					from: mutatorId,
					to: storeId,
					file: relativeFile,
					line,
				},
				context.relations,
				context.relationKeys,
			);
		}
	}
}
