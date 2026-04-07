import { describe, expect, it } from "vitest";
import { SyntaxKind } from "ts-morph";
import {
	collectNanostoresFrameworkImports,
	collectNanostoresStoreImports,
} from "../../../src/domain/project/scanner/imports.ts";
import {
	analyzeSubscribersInFile,
	findSubscriberContainerInfo,
	inferSubscriberKind,
	isUseStoreCall,
	type SubscriberAnalysisContext,
} from "../../../src/domain/project/scanner/subscribers.ts";
import {
	analyzeStoresInFile,
	type StoreAnalysisContext,
} from "../../../src/domain/project/scanner/stores.ts";
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
		const imports = collectNanostoresFrameworkImports(sourceFile);
		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		const results = calls.map(callExpr => ({
			text: callExpr.getText(),
			match: isUseStoreCall(callExpr, imports),
		}));

		expect(results.find(r => r.text === "useNanoStore($a)")?.match).toBe(true);
		expect(results.find(r => r.text === "nsReact.useStore($a)")?.match).toBe(true);
		expect(results.find(r => r.text === "useReactStore($a)")?.match).toBe(false);
	});

	it("detects Angular this.service.useStore() calls", () => {
		const code = [
			'import { NanostoresService } from "@nanostores/angular";',
			"",
			"class AppComponent {",
			"  constructor(private nanostores: NanostoresService) {}",
			"  ngOnInit() {",
			"    this.nanostores.useStore($a);",
			"  }",
			"}",
		].join("\n");
		const { sourceFile } = createSourceFile(code, "app.component.ts");
		const imports = collectNanostoresFrameworkImports(sourceFile);
		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		const results = calls.map(callExpr => ({
			text: callExpr.getText(),
			match: isUseStoreCall(callExpr, imports),
		}));

		expect(results.find(r => r.text === "this.nanostores.useStore($a)")?.match).toBe(true);
	});

	it("rejects this.otherService.useStore() without NanostoresService type", () => {
		const code = [
			'import { NanostoresService } from "@nanostores/angular";',
			"",
			"class AppComponent {",
			"  constructor(private nanostores: NanostoresService, private other: OtherService) {}",
			"  ngOnInit() {",
			"    this.other.useStore($a);",
			"  }",
			"}",
		].join("\n");
		const { sourceFile } = createSourceFile(code, "app.component.ts");
		const imports = collectNanostoresFrameworkImports(sourceFile);
		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		const results = calls.map(callExpr => ({
			text: callExpr.getText(),
			match: isUseStoreCall(callExpr, imports),
		}));

		expect(results.find(r => r.text === "this.other.useStore($a)")?.match).toBe(false);
	});

	it("infers subscriber kinds from names and extensions", () => {
		expect(inferSubscriberKind("src/useCounter.ts", "useCounter")).toBe("hook");
		expect(inferSubscriberKind("src/cartEffect.ts", "cartEffect")).toBe("effect");
		expect(inferSubscriberKind("src/Counter.tsx", "Counter")).toBe("component");
		expect(inferSubscriberKind("src/Counter.ts", "Counter")).toBe("component");
		expect(inferSubscriberKind("src/Widget.vue", "Widget")).toBe("component");
		expect(inferSubscriberKind("src/Widget.svelte", "Widget")).toBe("component");
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
			"stores.ts": ['import { atom } from "nanostores";', "export const $shared = atom(0);"].join(
				"\n",
			),
			"other.ts": ['import { atom } from "nanostores";', "export const $shared = atom(1);"].join(
				"\n",
			),
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
		const frameworkImports = collectNanostoresFrameworkImports(componentFile);
		analyzeSubscribersInFile(componentFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.storeIds.length).toBe(1);

		const matchedStore = storeContext.stores.find(store => store.id === subscriber.storeIds[0]);
		expect(toPosix(matchedStore?.file ?? "")).toBe("stores.ts");
	});

	it("falls back to name matching and same-file disambiguation", () => {
		const files = {
			"consumer.ts": ['import { useStore } from "nanostores/react";', "useStore($nameOnly);"].join(
				"\n",
			),
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
		const frameworkImports = collectNanostoresFrameworkImports(sourceFile);

		analyzeSubscribersInFile(sourceFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.storeIds).toEqual([storeA.id]);
	});

	it("skips ambiguous name matches without same-file candidate", () => {
		const files = {
			"consumer.ts": ['import { useStore } from "nanostores/react";', "useStore($ambiguous);"].join(
				"\n",
			),
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
		const frameworkImports = collectNanostoresFrameworkImports(sourceFile);
		analyzeSubscribersInFile(sourceFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(0);
	});

	it("detects Angular component subscribers via DI service", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $profile = atom({ name: 'John' });",
			].join("\n"),
			"app.component.ts": [
				'import { NanostoresService } from "@nanostores/angular";',
				'import { $profile } from "./stores";',
				"",
				"class AppComponent {",
				"  constructor(private nanostores: NanostoresService) {}",
				"  ngOnInit() {",
				"    this.nanostores.useStore($profile);",
				"  }",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const componentFile = sourceFiles.get("app.component.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(componentFile);
		analyzeSubscribersInFile(componentFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.name).toBe("AppComponent.ngOnInit");
		expect(subscriber.kind).toBe("component");
		expect(subscriber.storeIds.length).toBe(1);

		const matchedStore = storeContext.stores.find(s => s.id === subscriber.storeIds[0]);
		expect(matchedStore?.name).toBe("$profile");
	});

	it("detects $store.subscribe() as a subscriber", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $count = atom(0);",
			].join("\n"),
			"effect.ts": [
				'import { $count } from "./stores";',
				"",
				"function trackCount() {",
				"  $count.subscribe(value => console.log(value));",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const effectFile = sourceFiles.get("effect.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(effectFile);
		analyzeSubscribersInFile(effectFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.name).toBe("trackCount");
		expect(subscriber.kind).toBe("unknown");
		expect(subscriber.storeIds.length).toBe(1);

		const matchedStore = storeContext.stores.find(s => s.id === subscriber.storeIds[0]);
		expect(matchedStore?.name).toBe("$count");
	});

	it("detects $store.listen() as a subscriber", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $count = atom(0);",
			].join("\n"),
			"listener.ts": [
				'import { $count } from "./stores";',
				"",
				"function onChange() {",
				"  $count.listen(value => console.log(value));",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const listenerFile = sourceFiles.get("listener.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(listenerFile);
		analyzeSubscribersInFile(listenerFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.name).toBe("onChange");
		expect(subscriber.storeIds.length).toBe(1);
	});

	it("resolves .subscribe() store via symbol with name collisions", () => {
		const files = {
			"stores-a.ts": ['import { atom } from "nanostores";', "export const $val = atom(0);"].join(
				"\n",
			),
			"stores-b.ts": ['import { atom } from "nanostores";', "export const $val = atom(1);"].join(
				"\n",
			),
			"consumer.ts": [
				'import { $val } from "./stores-a";',
				"",
				"function setup() {",
				"  $val.subscribe(v => console.log(v));",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const consumerFile = sourceFiles.get("consumer.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(consumerFile);
		analyzeSubscribersInFile(consumerFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.storeIds.length).toBe(1);

		const matchedStore = storeContext.stores.find(s => s.id === subscriber.storeIds[0]);
		expect(toPosix(matchedStore?.file ?? "")).toBe("stores-a.ts");
	});

	it("accumulates .subscribe() and useStore() in the same container", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $a = atom(0);",
				"export const $b = atom(1);",
			].join("\n"),
			"mixed.tsx": [
				'import { useStore } from "nanostores/react";',
				'import { $a, $b } from "./stores";',
				"",
				"function Dashboard() {",
				"  useStore($a);",
				"  $b.subscribe(v => console.log(v));",
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

		const mixedFile = sourceFiles.get("mixed.tsx")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(mixedFile);
		analyzeSubscribersInFile(mixedFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.name).toBe("Dashboard");
		expect(subscriber.storeIds.length).toBe(2);
		expect(subscriber.kind).toBe("component");
	});

	it("ignores .subscribe() on non-store objects", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $count = atom(0);",
			].join("\n"),
			"service.ts": [
				'import { $count } from "./stores";',
				"",
				"const emitter = { subscribe: (fn: Function) => fn() };",
				"",
				"function setup() {",
				"  emitter.subscribe(() => {});",
				"  $count.subscribe(v => console.log(v));",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const serviceFile = sourceFiles.get("service.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(serviceFile);
		analyzeSubscribersInFile(serviceFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		// Only $count should be matched, not emitter
		expect(subscriber.storeIds.length).toBe(1);
		const matchedStore = storeContext.stores.find(s => s.id === subscriber.storeIds[0]);
		expect(matchedStore?.name).toBe("$count");
	});

	it("detects .subscribe() with import alias", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $count = atom(0);",
			].join("\n"),
			"aliased.ts": [
				'import { $count as $myCount } from "./stores";',
				"",
				"function setup() {",
				"  $myCount.subscribe(v => console.log(v));",
				"}",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const aliasedFile = sourceFiles.get("aliased.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(aliasedFile);
		analyzeSubscribersInFile(aliasedFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.storeIds.length).toBe(1);
		const matchedStore = storeContext.stores.find(s => s.id === subscriber.storeIds[0]);
		expect(matchedStore?.name).toBe("$count");
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
		const frameworkImports = collectNanostoresFrameworkImports(widgetFile);
		analyzeSubscribersInFile(widgetFile, absRoot, frameworkImports, subscriberContext);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.line).toBe(5);
	});

	it("detects effect([store1, store2], fn) as a multi-store subscriber", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $user = atom<string | null>(null);",
				"export const $isLoading = atom(false);",
			].join("\n"),
			"auth.ts": [
				'import { effect } from "nanostores";',
				'import { $user, $isLoading } from "./stores";',
				"",
				"effect([$user, $isLoading], () => {",
				"  console.log($user.get(), $isLoading.get());",
				"});",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const authFile = sourceFiles.get("auth.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(authFile);
		const storeImports = collectNanostoresStoreImports(authFile);
		analyzeSubscribersInFile(authFile, absRoot, frameworkImports, subscriberContext, storeImports);

		expect(subscriberContext.subscribers.length).toBe(1);
		const subscriber = subscriberContext.subscribers[0];
		expect(subscriber.kind).toBe("effect");
		expect(subscriber.storeIds.length).toBe(2);

		const names = subscriber.storeIds.map(id => storeContext.stores.find(s => s.id === id)?.name);
		expect(names).toContain("$user");
		expect(names).toContain("$isLoading");
	});

	it("detects aliased effect import", () => {
		const files = {
			"stores.ts": ['import { atom } from "nanostores";', "export const $x = atom(0);"].join("\n"),
			"side.ts": [
				'import { effect as watchStores } from "nanostores";',
				'import { $x } from "./stores";',
				"",
				"watchStores([$x], () => { console.log($x.get()); });",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const sideFile = sourceFiles.get("side.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(sideFile);
		const storeImports = collectNanostoresStoreImports(sideFile);
		analyzeSubscribersInFile(sideFile, absRoot, frameworkImports, subscriberContext, storeImports);

		expect(subscriberContext.subscribers.length).toBe(1);
		expect(subscriberContext.subscribers[0].kind).toBe("effect");
		const names = subscriberContext.subscribers[0].storeIds.map(
			id => storeContext.stores.find(s => s.id === id)?.name,
		);
		expect(names).toContain("$x");
	});

	it("detects namespace effect call: import * as ns from 'nanostores'; ns.effect([...], fn)", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $count = atom(0);",
			].join("\n"),
			"side.ts": [
				'import * as ns from "nanostores";',
				'import { $count } from "./stores";',
				"",
				"ns.effect([$count], () => { console.log($count.get()); });",
			].join("\n"),
		};
		const { project, absRoot, sourceFiles } = createTsMorphProject(files, "/project");
		const storeContext = createStoreContext(absRoot);

		for (const sourceFile of project.getSourceFiles()) {
			const imports = collectNanostoresStoreImports(sourceFile);
			analyzeStoresInFile(sourceFile, absRoot, imports, storeContext);
		}

		const sideFile = sourceFiles.get("side.ts")!;
		const subscriberContext = createSubscriberContext(storeContext);
		const frameworkImports = collectNanostoresFrameworkImports(sideFile);
		const storeImports = collectNanostoresStoreImports(sideFile);
		analyzeSubscribersInFile(sideFile, absRoot, frameworkImports, subscriberContext, storeImports);

		expect(subscriberContext.subscribers).toHaveLength(1);
		expect(subscriberContext.subscribers[0].kind).toBe("effect");
		const names = subscriberContext.subscribers[0].storeIds.map(
			id => storeContext.stores.find(s => s.id === id)?.name,
		);
		expect(names).toContain("$count");
	});
});
