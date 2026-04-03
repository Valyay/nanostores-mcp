import { CallExpression, SyntaxKind, SourceFile, Node } from "ts-morph";
import path from "node:path";
import type { SubscriberMatch, SubscriberKind, StoreMatch } from "../types.js";
import type { NanostoresFrameworkImports } from "./imports.js";
import { getSymbolKey } from "./stores.js";
import { addRelation } from "./relations.js";

const SFC_EXTENSIONS = new Set([".vue", ".svelte"]);

/** Method names on store objects that count as direct subscriptions. */
const DIRECT_SUBSCRIBE_METHODS = new Set(["subscribe", "listen"]);

function isSfcFile(filePath: string): boolean {
	return SFC_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export interface SubscriberContainerInfo {
	containerName?: string;
	containerStartLine: number;
}

export interface SubscriberAccumulator {
	storeIds: Set<string>;
	firstUseLine?: number;
	kind: SubscriberKind;
	name?: string;
	containerStartLine: number;
}

/**
 * If `callExpr` is `$store.subscribe(fn)` or `$store.listen(fn)`,
 * try to resolve the receiver to a known store.
 * Returns matched stores or empty array when the call is not a direct subscribe.
 */
export function tryResolveDirectSubscribe(
	callExpr: CallExpression,
	context: Pick<SubscriberAnalysisContext, "storesBySymbol" | "storesByName">,
	relativeFile: string,
): StoreMatch[] {
	const expr = callExpr.getExpression();
	if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return [];

	const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
	const methodName = propAccess.getName();

	if (!DIRECT_SUBSCRIBE_METHODS.has(methodName)) return [];

	const receiver = propAccess.getExpression();
	if (receiver.getKind() !== SyntaxKind.Identifier) return [];

	const identifier = receiver.asKindOrThrow(SyntaxKind.Identifier);

	// Resolve via symbol first
	const sym = identifier.getSymbol();
	if (sym) {
		const key = getSymbolKey(sym);
		const matches = context.storesBySymbol.get(key);
		if (matches && matches.length > 0) return matches;
	}

	// Fallback by name
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

/**
 * Check that the call is useStore from a nanostores framework module:
 * - useStore(...) or useNanoStore(...)         — standalone function
 * - nsReact.useStore(...)                      — namespace import
 * - this.nanostores.useStore(...)              — Angular DI service
 */
export function isUseStoreCall(
	callExpr: CallExpression,
	imports: NanostoresFrameworkImports,
): boolean {
	const expr = callExpr.getExpression();

	// useStore(...)
	if (expr.getKind() === SyntaxKind.Identifier) {
		const fnName = expr.getText();
		return imports.useStoreFns.has(fnName);
	}

	// nsReact.useStore(...) or this.nanostores.useStore(...)
	if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
		const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
		const propName = propAccess.getName();

		if (propName !== "useStore") return false;

		const obj = propAccess.getExpression();

		// nsReact.useStore(...)
		if (obj.getKind() === SyntaxKind.Identifier) {
			return imports.frameworkNamespaces.has(obj.getText());
		}

		// this.nanostores.useStore(...) — Angular DI pattern
		if (
			imports.angularServiceNames.size > 0 &&
			obj.getKind() === SyntaxKind.PropertyAccessExpression
		) {
			const innerAccess = obj.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
			const innerObj = innerAccess.getExpression();
			const serviceName = innerAccess.getName();

			if (innerObj.getKind() === SyntaxKind.ThisKeyword) {
				return imports.angularServiceNames.has(serviceName);
			}
		}
	}

	return false;
}

export function findSubscriberContainerInfo(callExpr: CallExpression): SubscriberContainerInfo {
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

			// Anonymous function without variable — treat the function itself as subscriber
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

		// useStore directly in class body
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

	// Fallback: treat the file/body itself as subscriber
	return {
		containerName: undefined,
		containerStartLine: callExpr.getStartLineNumber(),
	};
}

export function inferSubscriberKind(relativeFile: string, containerName?: string): SubscriberKind {
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
		(ext === ".tsx" ||
			ext === ".jsx" ||
			ext === ".js" ||
			ext === ".ts" ||
			ext === ".vue" ||
			ext === ".svelte")
	) {
		return "component";
	}

	if (ext === ".tsx" || ext === ".jsx" || ext === ".vue" || ext === ".svelte") {
		return "component";
	}

	return "unknown";
}

export interface SubscriberAnalysisContext {
	absRoot: string;
	subscribers: SubscriberMatch[];
	storesByName: Map<string, StoreMatch[]>;
	storesBySymbol: Map<string, StoreMatch[]>;
	relations: import("../types.js").StoreRelation[];
	relationKeys: Set<string>;
}

/**
 * Analyzes source file and finds all store subscriptions
 */
export function analyzeSubscribersInFile(
	sourceFile: SourceFile,
	absRoot: string,
	frameworkImports: NanostoresFrameworkImports,
	context: SubscriberAnalysisContext,
): void {
	const absPath = sourceFile.getFilePath();
	const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

	const subscriberAccumulators = new Map<string, SubscriberAccumulator>();

	const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

	for (const callExpr of callExpressions) {
		let matches: StoreMatch[] = [];

		// Path A: direct .subscribe() / .listen() on a store object
		const directMatches = tryResolveDirectSubscribe(callExpr, context, relativeFile);
		if (directMatches.length > 0) {
			matches = directMatches;
		}

		// Path B: useStore($store) from a framework adapter
		if (matches.length === 0 && isUseStoreCall(callExpr, frameworkImports)) {
			const args = callExpr.getArguments();
			if (!args[0] || args[0].getKind() !== SyntaxKind.Identifier) continue;

			const firstArg = args[0].asKindOrThrow(SyntaxKind.Identifier);

			const sym = firstArg.getSymbol();

			if (sym) {
				const key = getSymbolKey(sym);
				matches = context.storesBySymbol.get(key) ?? [];
			}

			// Fallback by name
			if (matches.length === 0) {
				const storeVarName = firstArg.getText();
				const byName = context.storesByName.get(storeVarName) ?? [];

				if (byName.length === 1) {
					matches = byName;
				} else if (byName.length > 1) {
					const sameFile = byName.filter(s => s.file === relativeFile);
					if (sameFile.length === 1) {
						matches = sameFile;
					} else if (isSfcFile(relativeFile)) {
						// SFC virtual files can't resolve cross-file symbols, so
						// accept all name matches rather than losing the subscriber.
						matches = byName;
					}
				}
			}

			// Fallback by import alias: import { $store as localName } from "..."
			if (matches.length === 0) {
				const storeVarName = firstArg.getText();
				for (const imp of sourceFile.getImportDeclarations()) {
					for (const named of imp.getNamedImports()) {
						const local = named.getAliasNode()?.getText();
						if (local === storeVarName) {
							const importedName = named.getName();
							const byImported = context.storesByName.get(importedName) ?? [];
							if (byImported.length === 1) {
								matches = byImported;
							}
						}
					}
					if (matches.length > 0) break;
				}
			}
		}

		if (matches.length === 0) {
			continue;
		}

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

	// Create SubscriberMatch for each container
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

		context.subscribers.push(subscriber);

		// file -> subscriber relation
		addRelation(
			{
				type: "declares",
				from: `file:${relativeFile}`,
				to: subscriberId,
				file: relativeFile,
				line,
			},
			context.relations,
			context.relationKeys,
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
				context.relations,
				context.relationKeys,
			);
		}
	}
}
