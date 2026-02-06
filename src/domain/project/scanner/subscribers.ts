import { CallExpression, SyntaxKind, SourceFile, Node } from "ts-morph";
import path from "node:path";
import type { SubscriberMatch, SubscriberKind, StoreMatch } from "../types.js";
import type { NanostoresReactImports } from "./imports.js";
import { getSymbolKey } from "./stores.js";
import { addRelation } from "./relations.js";

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
 * Check that the call is useStore from nanostores/react:
 * - useStore(...) or useNanoStore(...)
 * - nsReact.useStore(...)
 */
export function isUseStoreCall(callExpr: CallExpression, imports: NanostoresReactImports): boolean {
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
	reactImports: NanostoresReactImports,
	context: SubscriberAnalysisContext,
): void {
	const absPath = sourceFile.getFilePath();
	const relativeFile = path.relative(absRoot, absPath) || path.basename(absPath);

	const subscriberAccumulators = new Map<string, SubscriberAccumulator>();

	const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

	for (const callExpr of callExpressions) {
		// Check that this is a useStore call from nanostores/react
		if (!isUseStoreCall(callExpr, reactImports)) continue;

		const args = callExpr.getArguments();
		if (!args[0] || args[0].getKind() !== SyntaxKind.Identifier) continue;

		const firstArg = args[0].asKindOrThrow(SyntaxKind.Identifier);

		let matches: StoreMatch[] = [];
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
