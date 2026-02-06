import { describe, expect, it } from "vitest";
import { SyntaxKind } from "ts-morph";
import { collectNanostoresReactImports, collectNanostoresStoreImports } from "../../../src/domain/project/scanner/imports.ts";
import {
	analyzeSubscribersInFile,
	findSubscriberContainerInfo,
	inferSubscriberKind,
	isUseStoreCall,
	type SubscriberAnalysisContext,
} from "../../../src/domain/project/scanner/subscribers.ts";
import { analyzeStoresInFile, type StoreAnalysisContext } from "../../../src/domain/project/scanner/stores.ts";
import { createSourceFile, createTsMorphProject } from "../../helpers/tsMorphProject.ts";
import { toPosix } from "../../helpers/fixtures.ts";

function createStoreContext(absRoot: string): StoreAnalysisContext {
	return {
		absRoot,
		stores: [],
		storesByName: new Map(),
		storesBySymbol: new Map(),
		derivedStubs: [],
		relations: [],
		relationKeys: new Set(),
	};
}

function createSubscriberContext(storeContext: StoreAnalysisContext): SubscriberAnalysisContext {
	return {
		absRoot: storeContext.absRoot,
		subscribers: [],
		storesByName: storeContext.storesByName,
		storesBySymbol: storeContext.storesBySymbol,
		relations: storeContext.relations,
		relationKeys: storeContext.relationKeys,
	};
}

describe("scanner/subscribers", () => {
	it("detects useStore calls by identifier and namespace", () => {
		const code = [
			'import { useStore as useNanoStore } from "nanostores/react";',
			'import * as nsReact from "@nanostores/react";',
			'import { useStore as useReactStore } from "react";',
			"",
			"useNanoStore($a);",
			"nsReact.useStore($a);",
			"useReactStore($a);",
		].join("\n");
		const { sourceFile } = createSourceFile(code, "Component.tsx");
		const imports = collectNanostoresReactImports(sourceFile);
		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		const results = calls.map(callExpr => ({
			text: callExpr.getText(),
			match: isUseStoreCall(callExpr, imports),
		}));

		expect(results.find(r => r.text === "useNanoStore($a)")?.match).toBe(true);
		expect(results.find(r => r.text === "nsReact.useStore($a)")?.match).toBe(true);
		expect(results.find(r => r.text === "useReactStore($a)")?.match).toBe(false);
	});

	it("infers subscriber kinds from names and extensions", () => {
		expect(inferSubscriberKind("src/useCounter.ts", "useCounter")).toBe("hook");
		expect(inferSubscriberKind("src/cartEffect.ts", "cartEffect")).toBe("effect");
		expect(inferSubscriberKind("src/Counter.tsx", "Counter")).toBe("component");
		expect(inferSubscriberKind("src/Counter.ts", "Counter")).toBe("component");
		expect(inferSubscriberKind("src/anon.ts")).toBe("unknown");
		expect(inferSubscriberKind("src/Anon.tsx")).toBe("component");
	});

	it("finds container info for functions and methods", () => {
		const code = [
			'import { useStore } from "nanostores/react";',
			"",
			"function Counter() {",
			"  useStore($a);",
			"}",
			"",
			"class C {",
			"  render() {",
			"    useStore($a);",
			"  }",
			"}",
		].join("\n");
		const { sourceFile } = createSourceFile(code, "Component.tsx");
		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		const first = findSubscriberContainerInfo(calls[0]);
		expect(first.containerName).toBe("Counter");
		expect(first.containerStartLine).toBe(3);

		const second = findSubscriberContainerInfo(calls[1]);
		expect(second.containerName).toBe("C.render");
	});

	it("matches stores by symbol even with name collisions", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $shared = atom(0);",
			].join("\n"),
			"other.ts": [
				'import { atom } from "nanostores";',
				"export const $shared = atom(1);",
			].join("\n"),
			"component.tsx": [
				'import { useStore } from "nanostores/react";',
				'import { $shared } from "./stores";',
				"export function Widget() {",
				"  useStore($shared);",
				"  return null;",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const componentFile = sourceFiles.get("component.tsx")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const reactImports = collectNanostoresReactImports(componentFile);
		analyzeSubscribersInFile(componentFile, absRoot, reactImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.storeIds.length).toBe(1);

		const matchedStore = storeContext.stores.find(store => store.id === subscriber.storeIds[0]);
		expect(toPosix(matchedStore?.file ?? "")).toBe("stores.ts");
	});

	it("falls back to name matching and same-file disambiguation", () => {
		const files = {
			"consumer.ts": [
				'import { useStore } from "nanostores/react";',
				"useStore($nameOnly);",
			].join("\n"),
		};
		const { absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		const storeA = {
			id: "store:consumer.ts#$nameOnly",
			file: "consumer.ts",
			line: 1,
			kind: "atom" as const,
			name: "$nameOnly",
		};
		const storeB = {
			id: "store:other.ts#$nameOnly",
			file: "other.ts",
			line: 1,
			kind: "atom" as const,
			name: "$nameOnly",
		};
		storeContext.stores.push(storeA, storeB);
		storeContext.storesByName.set("$nameOnly", [storeA, storeB]);

		const subscriberContext = createSubscriberContext(storeContext);
		const sourceFile = sourceFiles.get("consumer.ts")!;
		const reactImports = collectNanostoresReactImports(sourceFile);

		analyzeSubscribersInFile(sourceFile, absRoot, reactImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.storeIds).toEqual([storeA.id]);
	});

	it("skips ambiguous name matches without same-file candidate", () => {
		const files = {
			"consumer.ts": [
				'import { useStore } from "nanostores/react";',
				"useStore($ambiguous);",
			].join("\n"),
		};
		const { absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		const storeA = {
			id: "store:a.ts#$ambiguous",
			file: "a.ts",
			line: 1,
			kind: "atom" as const,
			name: "$ambiguous",
		};
		const storeB = {
			id: "store:b.ts#$ambiguous",
			file: "b.ts",
			line: 1,
			kind: "atom" as const,
			name: "$ambiguous",
		};
		storeContext.stores.push(storeA, storeB);
		storeContext.storesByName.set("$ambiguous", [storeA, storeB]);

		const subscriberContext = createSubscriberContext(storeContext);
		const sourceFile = sourceFiles.get("consumer.ts")!;
		const reactImports = collectNanostoresReactImports(sourceFile);
		analyzeSubscribersInFile(sourceFile, absRoot, reactImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(0);
	});

	it("tracks first useStore line in a container", () => {
		const files = {
			"widget.tsx": [
				'import { useStore } from "nanostores/react";',
				'import { atom } from "nanostores";',
				"const $a = atom(0);",
				"export function Widget() {",
				"  useStore($a);",
				"  useStore($a);",
				"  return null;",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const widgetFile = sourceFiles.get("widget.tsx")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const reactImports = collectNanostoresReactImports(widgetFile);
		analyzeSubscribersInFile(widgetFile, absRoot, reactImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.line).toBe(5);
	});
});
