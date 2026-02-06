import { describe, expect, it } from "vitest";
import { SyntaxKind } from "ts-morph";
import { collectNanostoresStoreImports } from "../../../src/domain/project/scanner/imports.ts";
import {
	analyzeStoresInFile,
	getStoreKindFromCall,
	getSymbolKey,
	type StoreAnalysisContext,
} from "../../../src/domain/project/scanner/stores.ts";
import { createSourceFile } from "../../helpers/tsMorphProject.ts";
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

describe("scanner/stores", () => {
	it("resolves store kinds from aliases and namespaces", () => {
		const code = [
			'import { atom as createAtom } from "nanostores";',
			'import * as ns from "nanostores";',
			'import { persistentAtom } from "@nanostores/persistent";',
			"",
			"const $a = createAtom(0);",
			"const $b = ns.map({});",
			"const $c = persistentAtom(\"k\", 1);",
		].join("\n");
		const { sourceFile } = createSourceFile(code, "stores.ts");
		const importsInfo = collectNanostoresStoreImports(sourceFile);

		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
		const kindByText = new Map(
			calls.map(callExpr => [callExpr.getText(), getStoreKindFromCall(callExpr, importsInfo)]),
		);

		expect(kindByText.get("createAtom(0)")).toBe("atom");
		expect(kindByText.get("ns.map({})")).toBe("map");
		expect(kindByText.get('persistentAtom("k", 1)')).toBe("persistentAtom");
	});

	it("records store matches, relations, and derived stubs", () => {
		const code = [
			'import { atom, computed, map } from "nanostores";',
			"",
			"const $a = atom(0);",
			"const $b = map({});",
			"const $derived = computed($a, value => value);",
			"const $derivedArray = computed([$a, $b, $a], (a, b) => a + b.count);",
			"const $self = computed($self, value => value);",
		].join("\n");
		const { sourceFile, absRoot } = createSourceFile(code, "src/stores.ts");
		const importsInfo = collectNanostoresStoreImports(sourceFile);
		const context = createStoreContext(absRoot);

		analyzeStoresInFile(sourceFile, absRoot, importsInfo, context);

		expect(context.stores.map(store => store.name)).toEqual(
			expect.arrayContaining(["$a", "$b", "$derived", "$derivedArray", "$self"]),
		);
		const derivedStubNames = context.derivedStubs.map(stub => `${stub.derivedVar}->${stub.dependsOnVar}`);
		expect(derivedStubNames).toContain("$derived->$a");
		expect(derivedStubNames).toContain("$derivedArray->$a");
		expect(derivedStubNames).toContain("$derivedArray->$b");
		expect(derivedStubNames.some(name => name.startsWith("$self->"))).toBe(false);
		expect(derivedStubNames.filter(name => name === "$derivedArray->$a").length).toBe(1);

		const declares = context.relations.filter(rel => rel.type === "declares");
		expect(declares.length).toBe(context.stores.length);
	});

	it("builds symbol keys using declaration location", () => {
		const code = [
			'import { atom } from "nanostores";',
			"",
			"const $count = atom(0);",
		].join("\n");
		const { sourceFile } = createSourceFile(code, "src/stores.ts");
		const decl = sourceFile.getVariableDeclarationOrThrow("$count");
		const symbol = decl.getNameNode()?.getSymbol();

		expect(symbol).toBeTruthy();
		const key = getSymbolKey(symbol!);
		expect(key).toContain("$count@");
		expect(toPosix(key)).toContain("/project/src/stores.ts:");
	});
});
