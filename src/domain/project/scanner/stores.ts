import { CallExpression, SyntaxKind, SourceFile, Symbol as TsSymbol, Node, Type } from "ts-morph";
import path from "node:path";
import type { StoreMatch, StoreKind, StoreRelation, StoreFlags } from "../types.js";
import { isDerivedKind, normalizeStoreKind } from "../types.js";
import type { NanostoresStoreImports } from "./imports.js";
import { addRelation } from "./relations.js";

const SIDE_EFFECT_METHODS = new Set(["set", "setKey", "subscribe", "listen"]);
const CLEANUP_METHODS = new Set(["destroy"]);
const SIDE_EFFECT_GLOBALS = new Set(["setTimeout", "setInterval", "fetch"]);

interface ComputedSideEffectResult {
	hasSideEffects: boolean;
	hasCleanupCalls: boolean;
}

/** Detects side-effectful and cleanup calls inside a computed callback. */
function detectComputedSideEffects(callExpr: CallExpression): ComputedSideEffectResult {
	const args = callExpr.getArguments();
	const callback = args[args.length - 1];
	if (!callback) return { hasSideEffects: false, hasCleanupCalls: false };

	const k = callback.getKind();
	if (k !== SyntaxKind.ArrowFunction && k !== SyntaxKind.FunctionExpression) {
		return { hasSideEffects: false, hasCleanupCalls: false };
	}

	let hasSideEffects = false;
	let hasCleanupCalls = false;

	for (const inner of callback.getDescendantsOfKind(SyntaxKind.CallExpression)) {
		const expr = inner.getExpression();
		if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
			const name = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
			if (SIDE_EFFECT_METHODS.has(name)) hasSideEffects = true;
			if (CLEANUP_METHODS.has(name)) hasCleanupCalls = true;
		}
		if (expr.getKind() === SyntaxKind.Identifier && SIDE_EFFECT_GLOBALS.has(expr.getText())) {
			hasSideEffects = true;
		}
	}
	return { hasSideEffects, hasCleanupCalls };
}

/** Returns true if the node is declared inside a function body (factory pattern). */
function isInsideFunction(node: Node): boolean {
	let parent = node.getParent();
	while (parent && !Node.isSourceFile(parent)) {
		if (
			Node.isFunctionDeclaration(parent) ||
			Node.isArrowFunction(parent) ||
			Node.isFunctionExpression(parent)
		)
			return true;
		parent = parent.getParent();
	}
	return false;
}

/**
 * After stores are indexed, marks stores that have an onMount() call in the same file.
 * Must be called after analyzeStoresInFile so storesByName/storesBySymbol are populated.
 */
export function detectMountDependentActivation(
	sourceFile: SourceFile,
	context: Pick<StoreAnalysisContext, "storesByName" | "storesBySymbol">,
	onMountFns: Set<string>,
): void {
	if (onMountFns.size === 0) return;

	for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
		const expr = callExpr.getExpression();
		if (expr.getKind() !== SyntaxKind.Identifier) continue;
		if (!onMountFns.has(expr.getText())) continue;

		const firstArg = callExpr.getArguments()[0];
		if (!firstArg || firstArg.getKind() !== SyntaxKind.Identifier) continue;

		const ident = firstArg.asKindOrThrow(SyntaxKind.Identifier);
		const sym = ident.getSymbol();
		let matches: StoreMatch[] = [];

		if (sym) {
			const key = getSymbolKey(sym);
			matches = context.storesBySymbol.get(key) ?? [];
		}
		if (matches.length === 0) {
			matches = context.storesByName.get(ident.getText()) ?? [];
		}

		for (const store of matches) {
			store.flags ??= {};
			store.flags.hasMountDependentActivation = true;
		}
	}
}

export interface DerivedStub {
	derivedVar: string;
	dependsOnVar: string;
	file: string;
	line: number;
	derivedSymbolKey?: string;
	dependsOnSymbolKey?: string;
}

export function getSymbolKey(symbol: TsSymbol): string {
	const resolvedSymbol = symbol.getAliasedSymbol() ?? symbol;
	const decl = (resolvedSymbol.getDeclarations()[0] ?? undefined) as Node | undefined;
	if (decl) {
		const filePath = decl.getSourceFile().getFilePath();
		const line = decl.getStartLineNumber();
		return `${resolvedSymbol.getName()}@${filePath}:${line}`;
	}
	return resolvedSymbol.getName();
}

/**
 * Extract the TypeScript value type for a store call expression.
 * Prefers explicit type arguments (atom<number>) over inference.
 * Falls back to widening the first argument's literal type.
 */
export function extractStoreValueType(callExpr: CallExpression): string | undefined {
	// 1. Explicit type argument wins: atom<number>(0) or computed<string>(...) → "number"
	const typeArgs = callExpr.getTypeArguments();
	if (typeArgs.length > 0) {
		return typeArgs[0].getText();
	}

	const args = callExpr.getArguments();
	if (args.length === 0) return undefined;

	// 2. If the last argument is a callback (arrow/function), use its return type.
	//    This handles computed/batched: computed($a, (n) => n * 2) → last arg is the fn.
	const lastArg = args[args.length - 1];
	const lastArgKind = lastArg.getKind();
	if (lastArgKind === SyntaxKind.ArrowFunction || lastArgKind === SyntaxKind.FunctionExpression) {
		const returnType = lastArg.getType().getCallSignatures()[0]?.getReturnType();
		if (!returnType) return undefined;
		const typeText = returnType.getText();
		if (typeText === "unknown" || typeText === "any" || typeText === "never") return undefined;
		return typeText;
	}

	// 3. Base stores: widen literal initial value → atom(0) → "number", atom("") → "string"
	const argType: Type = args[0].getType();
	if (argType.isLiteral()) {
		return argType.getBaseTypeOfLiteralType().getText();
	}

	const typeText = argType.getText();
	if (typeText === "unknown" || typeText === "any" || typeText === "never") return undefined;
	return typeText;
}

/**
 * Determine StoreKind from function call, considering:
 * - aliases: import { atom as createAtom } from "nanostores"
 * - namespace: import * as ns from "nanostores"; ns.atom(...)
 */
export function getStoreKindFromCall(
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

export interface StoreAnalysisContext {
	absRoot: string;
	stores: StoreMatch[];
	storesByName: Map<string, StoreMatch[]>;
	storesBySymbol: Map<string, StoreMatch[]>;
	derivedStubs: DerivedStub[];
	relations: StoreRelation[];
	relationKeys: Set<string>;
}

/**
 * Analyzes source file and finds all store declarations
 */
export function analyzeStoresInFile(
	sourceFile: SourceFile,
	absRoot: string,
	importsInfo: NanostoresStoreImports,
	context: StoreAnalysisContext,
): void {
	const absPath = sourceFile.getFilePath();
	const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

	const variableStatements = sourceFile.getDescendantsOfKind(SyntaxKind.VariableStatement);

	for (const statement of variableStatements) {
		for (const declaration of statement.getDeclarations()) {
			const initializer = declaration.getInitializer();
			if (!initializer || initializer.getKind() !== SyntaxKind.CallExpression) continue;

			const callExpr = initializer.asKindOrThrow(SyntaxKind.CallExpression);

			const kind = getStoreKindFromCall(callExpr, importsInfo);
			if (!kind) continue;

			const varName = declaration.getName();
			const line = declaration.getStartLineNumber();

			const id = `store:${relativeFile}#${varName}`;

			const flags: StoreFlags = {};
			if (isDerivedKind(kind)) {
				const { hasSideEffects, hasCleanupCalls } = detectComputedSideEffects(callExpr);
				if (hasSideEffects) flags.computedHasSideEffects = true;
				if (hasCleanupCalls) flags.computedHasCleanupCalls = true;
			}
			if (isInsideFunction(declaration)) {
				flags.isInsideFactory = true;
			}

			const store: StoreMatch = {
				id,
				file: relativeFile,
				line,
				kind,
				name: varName,
				valueType: extractStoreValueType(callExpr),
				flags: Object.keys(flags).length > 0 ? flags : undefined,
			};
			context.stores.push(store);

			const byName = context.storesByName.get(varName) ?? [];
			byName.push(store);
			context.storesByName.set(varName, byName);

			let storeSymbolKey: string | undefined;
			const nameNode = (declaration as { getNameNode?: () => Node }).getNameNode?.() as
				| Node
				| undefined;
			const symbol = nameNode?.getSymbol();
			if (symbol) {
				storeSymbolKey = getSymbolKey(symbol);
				const bySymbol = context.storesBySymbol.get(storeSymbolKey) ?? [];
				bySymbol.push(store);
				context.storesBySymbol.set(storeSymbolKey, bySymbol);
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
				context.relations,
				context.relationKeys,
			);

			// For derived stores, find dependencies from the first argument
			if (isDerivedKind(kind)) {
				const [depsArg] = callExpr.getArguments();
				if (!depsArg) {
					// computed() without deps — odd, skip
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

					// Remove duplicates by name
					const unique = new Map<string, string | undefined>();
					for (const { name, symbolKey } of depCandidates) {
						if (!unique.has(name)) unique.set(name, symbolKey);
					}

					for (const [depName, depSymbolKey] of unique) {
						if (depName === varName) continue;

						context.derivedStubs.push({
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
