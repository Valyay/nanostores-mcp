import { describe, expect, it } from "vitest";
import { computeImperativeFlags } from "../../../src/domain/project/scanner/imperativeFlags.ts";
import { analyzeImperativeReadsInFile } from "../../../src/domain/project/scanner/imperativeFlags.ts";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import { createSourceFile } from "../../helpers/tsMorphProject.ts";
import {
	analyzeStoresInFile,
	type StoreAnalysisContext,
} from "../../../src/domain/project/scanner/stores.ts";
import { collectNanostoresStoreImports } from "../../../src/domain/project/scanner/imports.ts";

function makeIndex(overrides?: Partial<ProjectIndex>): ProjectIndex {
	return {
		rootDir: "/project",
		filesScanned: 1,
		stores: [],
		subscribers: [],
		mutators: [],
		relations: [],
		...overrides,
	};
}

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

describe("computeImperativeFlags — writtenWithoutSubscribers", () => {
	it("sets writtenWithoutSubscribers when store has mutators but no subscribers", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$count", file: "stores.ts", line: 1, kind: "atom", name: "$count" }],
			relations: [
				{ type: "mutates", from: "mutator:actions.ts#increment", to: "store:stores.ts#$count" },
			],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.writtenWithoutSubscribers).toBe(true);
	});

	it("does not set writtenWithoutSubscribers when store also has subscribers", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$count", file: "stores.ts", line: 1, kind: "atom", name: "$count" }],
			relations: [
				{ type: "mutates", from: "mutator:actions.ts#increment", to: "store:stores.ts#$count" },
				{ type: "subscribes_to", from: "subscriber:App.tsx#App", to: "store:stores.ts#$count" },
			],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.writtenWithoutSubscribers).toBeUndefined();
	});

	it("does not set writtenWithoutSubscribers when store has no mutators at all", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$count", file: "stores.ts", line: 1, kind: "atom", name: "$count" }],
			relations: [],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.writtenWithoutSubscribers).toBeUndefined();
	});

	it("does not set writtenWithoutSubscribers when storyOrTestOnlyWriter explains all mutations", () => {
		// storyOrTestOnlyWriter fully explains the absence of subscribers — no need to also flag writtenWithoutSubscribers
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$modal", file: "stores.ts", line: 1, kind: "atom", name: "$modal" }],
			mutators: [{ id: "mutator:Modal.stories.ts#setup", file: "Modal.stories.ts", line: 5, kind: "function", name: "setup", storeIds: ["store:stores.ts#$modal"] }],
			relations: [
				{ type: "mutates", from: "mutator:Modal.stories.ts#setup", to: "store:stores.ts#$modal" },
			],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.storyOrTestOnlyWriter).toBe(true);
		expect(index.stores[0].flags?.writtenWithoutSubscribers).toBeUndefined();
	});

	it("does not set writtenWithoutSubscribers on base atom used as computed source", () => {
		// $filter → computed($filtered) ← subscriber
		// $filter is reactive through the derived chain — not dead, not imperative-only
		const index = makeIndex({
			stores: [
				{ id: "store:stores.ts#$filter", file: "stores.ts", line: 1, kind: "atom", name: "$filter" },
				{ id: "store:stores.ts#$filtered", file: "stores.ts", line: 2, kind: "computed", name: "$filtered" },
			],
			relations: [
				{ type: "mutates", from: "mutator:actions.ts#setFilter", to: "store:stores.ts#$filter" },
				{ type: "derives_from", from: "store:stores.ts#$filtered", to: "store:stores.ts#$filter" },
				{ type: "subscribes_to", from: "subscriber:App.tsx#App", to: "store:stores.ts#$filtered" },
			],
		});

		computeImperativeFlags(index);

		const filter = index.stores.find(s => s.name === "$filter");
		expect(filter?.flags?.writtenWithoutSubscribers).toBeUndefined();
	});
});

describe("analyzeImperativeReadsInFile — .get() detection", () => {
	it("collects store id when $store.get() is called", () => {
		const storeCode = ['import { atom } from "nanostores";', "export const $count = atom(0);"].join("\n");
		const readerCode = [
			'import { $count } from "./stores";',
			"const value = $count.get();",
		].join("\n");

		const { sourceFile: storesFile, absRoot } = createSourceFile(storeCode, "stores.ts");
		const importsInfo = collectNanostoresStoreImports(storesFile);
		const storeCtx = createStoreContext(absRoot);
		analyzeStoresInFile(storesFile, absRoot, importsInfo, storeCtx);

		const { sourceFile: readerFile } = createSourceFile(readerCode, "reader.ts", absRoot);
		const imperativeGetIds = new Set<string>();
		analyzeImperativeReadsInFile(readerFile, absRoot, storeCtx, imperativeGetIds);

		expect(imperativeGetIds.size).toBe(1);
		expect([...imperativeGetIds][0]).toContain("$count");
	});

	it("does not collect store id from .set() or other methods", () => {
		const storeCode = ['import { atom } from "nanostores";', "export const $count = atom(0);"].join("\n");
		const readerCode = [
			'import { $count } from "./stores";',
			"$count.set(5);",
		].join("\n");

		const { sourceFile: storesFile, absRoot } = createSourceFile(storeCode, "stores.ts");
		const importsInfo = collectNanostoresStoreImports(storesFile);
		const storeCtx = createStoreContext(absRoot);
		analyzeStoresInFile(storesFile, absRoot, importsInfo, storeCtx);

		const { sourceFile: readerFile } = createSourceFile(readerCode, "reader.ts", absRoot);
		const imperativeGetIds = new Set<string>();
		analyzeImperativeReadsInFile(readerFile, absRoot, storeCtx, imperativeGetIds);

		expect(imperativeGetIds.size).toBe(0);
	});
});

describe("computeImperativeFlags — readViaGetOnly", () => {
	it("sets readViaGetOnly when store is read via .get() and has no subscribers", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$count", file: "stores.ts", line: 1, kind: "atom", name: "$count" }],
			relations: [],
		});
		const imperativeGetIds = new Set(["store:stores.ts#$count"]);

		computeImperativeFlags(index, imperativeGetIds);

		expect(index.stores[0].flags?.readViaGetOnly).toBe(true);
	});

	it("does not set readViaGetOnly when store also has reactive subscribers", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$count", file: "stores.ts", line: 1, kind: "atom", name: "$count" }],
			relations: [
				{ type: "subscribes_to", from: "subscriber:App.tsx#App", to: "store:stores.ts#$count" },
			],
		});
		const imperativeGetIds = new Set(["store:stores.ts#$count"]);

		computeImperativeFlags(index, imperativeGetIds);

		expect(index.stores[0].flags?.readViaGetOnly).toBeUndefined();
	});
});

describe("computeImperativeFlags — storyOrTestOnlyWriter", () => {
	it("sets storyOrTestOnlyWriter when all mutators come from story files", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$modal", file: "stores.ts", line: 1, kind: "atom", name: "$modal" }],
			mutators: [{ id: "mutator:Modal.stories.ts#setup", file: "Modal.stories.ts", line: 5, kind: "function", name: "setup", storeIds: ["store:stores.ts#$modal"] }],
			relations: [
				{ type: "mutates", from: "mutator:Modal.stories.ts#setup", to: "store:stores.ts#$modal" },
			],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.storyOrTestOnlyWriter).toBe(true);
	});

	it("sets storyOrTestOnlyWriter when all mutators come from test files", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$flag", file: "stores.ts", line: 1, kind: "atom", name: "$flag" }],
			mutators: [{ id: "mutator:auth.test.ts#reset", file: "auth.test.ts", line: 3, kind: "function", name: "reset", storeIds: ["store:stores.ts#$flag"] }],
			relations: [{ type: "mutates", from: "mutator:auth.test.ts#reset", to: "store:stores.ts#$flag" }],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.storyOrTestOnlyWriter).toBe(true);
	});

	it("sets storyOrTestOnlyWriter when all mutators come from __tests__ directory", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$x", file: "stores.ts", line: 1, kind: "atom", name: "$x" }],
			mutators: [{ id: "mutator:__tests__/helpers.ts#set", file: "__tests__/helpers.ts", line: 1, kind: "function", name: "set", storeIds: ["store:stores.ts#$x"] }],
			relations: [{ type: "mutates", from: "mutator:__tests__/helpers.ts#set", to: "store:stores.ts#$x" }],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.storyOrTestOnlyWriter).toBe(true);
	});

	it("does not set storyOrTestOnlyWriter when any mutator is from a production file", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$modal", file: "stores.ts", line: 1, kind: "atom", name: "$modal" }],
			mutators: [
				{ id: "mutator:Modal.stories.ts#setup", file: "Modal.stories.ts", line: 5, kind: "function", name: "setup", storeIds: ["store:stores.ts#$modal"] },
				{ id: "mutator:actions.ts#openModal", file: "actions.ts", line: 10, kind: "function", name: "openModal", storeIds: ["store:stores.ts#$modal"] },
			],
			relations: [
				{ type: "mutates", from: "mutator:Modal.stories.ts#setup", to: "store:stores.ts#$modal" },
				{ type: "mutates", from: "mutator:actions.ts#openModal", to: "store:stores.ts#$modal" },
			],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.storyOrTestOnlyWriter).toBeUndefined();
	});

	it("does not set storyOrTestOnlyWriter when store has no mutators", () => {
		const index = makeIndex({
			stores: [{ id: "store:stores.ts#$count", file: "stores.ts", line: 1, kind: "atom", name: "$count" }],
			relations: [],
		});

		computeImperativeFlags(index);

		expect(index.stores[0].flags?.storyOrTestOnlyWriter).toBeUndefined();
	});
});
