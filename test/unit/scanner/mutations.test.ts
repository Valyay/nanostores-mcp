import { describe, expect, it } from "vitest";
import {
	analyzeMutationsInFile,
	inferMutatorKind,
	type MutationAnalysisContext,
} from "../../../src/domain/project/scanner/mutations.ts";
import {
	analyzeStoresInFile,
	type StoreAnalysisContext,
} from "../../../src/domain/project/scanner/stores.ts";
import { collectNanostoresStoreImports } from "../../../src/domain/project/scanner/imports.ts";
import { createTsMorphProject } from "../../helpers/tsMorphProject.ts";

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

function createMutationContext(storeCtx: StoreAnalysisContext): MutationAnalysisContext {
	return {
		absRoot: storeCtx.absRoot,
		mutators: [],
		storesByName: storeCtx.storesByName,
		storesBySymbol: storeCtx.storesBySymbol,
		relations: storeCtx.relations,
		relationKeys: storeCtx.relationKeys,
	};
}

describe("scanner/mutations", () => {
	it("detects $atom.set() call and creates mutates relation", () => {
		const files = {
			"stores.ts": ['import { atom } from "nanostores";', "export const $count = atom(0);"].join(
				"\n",
			),
			"actions.ts": [
				'import { $count } from "./stores";',
				"",
				"export function increment() {",
				"  $count.set($count.get() + 1);",
				"}",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		const actionsSF = sourceFiles.get("actions.ts")!;
		analyzeMutationsInFile(actionsSF, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(1);
		const mutator = mutCtx.mutators[0];
		expect(mutator.name).toBe("increment");
		expect(mutator.storeIds).toContain(storeCtx.stores[0].id);

		const mutatesRelations = mutCtx.relations.filter(r => r.type === "mutates");
		expect(mutatesRelations).toHaveLength(1);
		expect(mutatesRelations[0].from).toBe(mutator.id);
		expect(mutatesRelations[0].to).toBe(storeCtx.stores[0].id);
	});

	it("detects $map.setKey() call", () => {
		const files = {
			"stores.ts": [
				'import { map } from "nanostores";',
				"export const $user = map({ name: '' });",
			].join("\n"),
			"actions.ts": [
				'import { $user } from "./stores";',
				"",
				"export function setName(name: string) {",
				'  $user.setKey("name", name);',
				"}",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		const actionsSF = sourceFiles.get("actions.ts")!;
		analyzeMutationsInFile(actionsSF, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(1);
		expect(mutCtx.mutators[0].name).toBe("setName");
		expect(mutCtx.relations.filter(r => r.type === "mutates")).toHaveLength(1);
	});

	it("merges multiple mutations in the same function into one mutator", () => {
		const files = {
			"stores.ts": [
				'import { atom, map } from "nanostores";',
				"export const $count = atom(0);",
				"export const $user = map({ name: '' });",
			].join("\n"),
			"actions.ts": [
				'import { $count, $user } from "./stores";',
				"",
				"export function reset() {",
				"  $count.set(0);",
				'  $user.setKey("name", "");',
				"}",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		const actionsSF = sourceFiles.get("actions.ts")!;
		analyzeMutationsInFile(actionsSF, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(1);
		expect(mutCtx.mutators[0].storeIds).toHaveLength(2);
		expect(mutCtx.relations.filter(r => r.type === "mutates")).toHaveLength(2);
	});

	it("captures mutator from arrow function assigned to variable", () => {
		const files = {
			"stores.ts": ['import { atom } from "nanostores";', "export const $flag = atom(false);"].join(
				"\n",
			),
			"actions.ts": [
				'import { $flag } from "./stores";',
				"",
				"export const disable = () => {",
				"  $flag.set(false);",
				"};",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		const actionsSF = sourceFiles.get("actions.ts")!;
		analyzeMutationsInFile(actionsSF, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(1);
		expect(mutCtx.mutators[0].name).toBe("disable");
	});

	it("does not treat .notify() as a mutation — it invalidates without changing value", () => {
		const files = {
			"stores.ts": ['import { atom } from "nanostores";', "export const $x = atom(0);"].join("\n"),
			"side.ts": [
				'import { $x } from "./stores";',
				"",
				"export function ping() {",
				"  $x.notify();",
				"}",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		analyzeMutationsInFile(sourceFiles.get("side.ts")!, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(0);
		expect(mutCtx.relations.filter(r => r.type === "mutates")).toHaveLength(0);
	});

	it("does not create mutator for non-mutation methods like .get() or .subscribe()", () => {
		const files = {
			"stores.ts": ['import { atom } from "nanostores";', "export const $x = atom(0);"].join("\n"),
			"actions.ts": [
				'import { $x } from "./stores";',
				"",
				"export function read() {",
				"  return $x.get();",
				"}",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		const actionsSF = sourceFiles.get("actions.ts")!;
		analyzeMutationsInFile(actionsSF, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(0);
		expect(mutCtx.relations.filter(r => r.type === "mutates")).toHaveLength(0);
	});

	it("handles module-level mutation (outside any function)", () => {
		const files = {
			"stores.ts": [
				'import { atom } from "nanostores";',
				"export const $ready = atom(false);",
			].join("\n"),
			"init.ts": [
				'import { $ready } from "./stores";',
				"",
				"// top-level initialization",
				"$ready.set(true);",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		const storesSF = sourceFiles.get("stores.ts")!;
		analyzeStoresInFile(storesSF, absRoot, collectNanostoresStoreImports(storesSF), storeCtx);

		const mutCtx = createMutationContext(storeCtx);
		analyzeMutationsInFile(sourceFiles.get("init.ts")!, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(1);
		// module-level mutator gets the file basename as display name
		expect(mutCtx.mutators[0].name).toBe("init");
		expect(mutCtx.mutators[0].kind).toBe("unknown");
		expect(mutCtx.mutators[0].storeIds).toContain(storeCtx.stores[0].id);
	});

	it("resolves mutation by symbol when two files export same store name", () => {
		const files = {
			"stores/a.ts": ['import { atom } from "nanostores";', "export const $count = atom(0);"].join(
				"\n",
			),
			"stores/b.ts": [
				'import { atom } from "nanostores";',
				"export const $count = atom(100);",
			].join("\n"),
			"actions.ts": [
				'import { $count } from "./stores/a";',
				"",
				"export function increment() {",
				"  $count.set($count.get() + 1);",
				"}",
			].join("\n"),
		};
		const { sourceFiles, absRoot } = createTsMorphProject(files);

		const storeCtx = createStoreContext(absRoot);
		for (const [name, sf] of sourceFiles) {
			if (name.startsWith("stores/")) {
				analyzeStoresInFile(sf, absRoot, collectNanostoresStoreImports(sf), storeCtx);
			}
		}
		expect(storeCtx.stores).toHaveLength(2);

		const mutCtx = createMutationContext(storeCtx);
		analyzeMutationsInFile(sourceFiles.get("actions.ts")!, absRoot, mutCtx);

		expect(mutCtx.mutators).toHaveLength(1);
		// must resolve to stores/a.ts, not stores/b.ts
		const mutatedStoreId = mutCtx.mutators[0].storeIds[0];
		const mutatedStore = storeCtx.stores.find(s => s.id === mutatedStoreId)!;
		expect(mutatedStore.file).toContain("stores/a");
	});
});

describe("inferMutatorKind", () => {
	it("returns 'action' for files in an actions directory", () => {
		expect(inferMutatorKind("src/actions/auth.ts", "login")).toBe("action");
		expect(inferMutatorKind("src/user.actions.ts", "setUser")).toBe("action");
	});

	it("returns 'function' for plain named functions not in an actions file", () => {
		expect(inferMutatorKind("src/utils.ts", "loginAction")).toBe("function");
	});

	it("does NOT return 'action' for 'transaction' (contains 'action' as substring)", () => {
		// regression: /action/i would match 'tr-action-s'
		expect(inferMutatorKind("src/transactions.ts", "runTransaction")).not.toBe("action");
	});

	it("returns 'effect' for effect-named containers", () => {
		expect(inferMutatorKind("src/effects.ts", "syncEffect")).toBe("effect");
	});

	it("returns 'method' for class method containers (ClassName.method)", () => {
		expect(inferMutatorKind("src/store.ts", "UserService.updateProfile")).toBe("method");
	});

	it("returns 'function' for plain named functions", () => {
		expect(inferMutatorKind("src/utils.ts", "updateCart")).toBe("function");
	});

	it("returns 'unknown' when no container (module-level)", () => {
		expect(inferMutatorKind("src/init.ts")).toBe("unknown");
	});
});
