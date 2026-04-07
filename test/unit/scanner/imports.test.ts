import { describe, expect, it } from "vitest";
import {
	collectNanostoresFrameworkImports,
	collectNanostoresStoreImports,
} from "../../../src/domain/project/scanner/imports.ts";
import { createSourceFile } from "../../helpers/tsMorphProject.ts";

const source = [
	'import { atom, map as createMap } from "nanostores";',
	'import * as ns from "nanostores";',
	'import { persistentAtom } from "@nanostores/persistent";',
	'import * as nsPersist from "@nanostores/persistent";',
	'import { useStore as useNanoStore } from "nanostores/react";',
	'import { useStore } from "@nanostores/react";',
	'import * as nsReact from "@nanostores/react";',
	'import { useStore as useVueStore } from "nanostores/vue";',
	'import { useStore as useReactStore } from "react";',
	"",
	"export const value = atom(1);",
].join("\n");

describe("scanner/imports", () => {
	it("collects store factories and namespaces from base and persistent modules", () => {
		const { sourceFile } = createSourceFile(source, "stores.ts");
		const info = collectNanostoresStoreImports(sourceFile);

		expect(info.storeFactories.get("atom")).toBe("atom");
		expect(info.storeFactories.get("createMap")).toBe("map");
		expect(info.storeFactories.get("persistentAtom")).toBe("persistentAtom");
		expect(info.nanostoresNamespaces.has("ns")).toBe(true);
		expect(info.nanostoresNamespaces.has("nsPersist")).toBe(false);
	});

	it("collects useStore imports and namespaces from framework modules", () => {
		const { sourceFile } = createSourceFile(source, "components.tsx");
		const info = collectNanostoresFrameworkImports(sourceFile);

		expect(info.useStoreFns.has("useNanoStore")).toBe(true);
		expect(info.useStoreFns.has("useStore")).toBe(true);
		expect(info.useStoreFns.has("useVueStore")).toBe(false);
		expect(info.useStoreFns.has("useReactStore")).toBe(false);
		expect(info.frameworkNamespaces.has("nsReact")).toBe(true);
	});

	it("collects Angular service names from constructor DI", () => {
		const angularSource = [
			'import { NanostoresService } from "@nanostores/angular";',
			"",
			"class AppComponent {",
			"  constructor(private nanostores: NanostoresService) {}",
			"}",
		].join("\n");
		const { sourceFile } = createSourceFile(angularSource, "app.component.ts");
		const info = collectNanostoresFrameworkImports(sourceFile);

		expect(info.angularServiceNames.has("nanostores")).toBe(true);
		expect(info.angularServiceNames.size).toBe(1);
	});

	it("tracks aliased NanostoresService imports", () => {
		const angularSource = [
			'import { NanostoresService as NanoSvc } from "@nanostores/angular";',
			"",
			"class ProfileComponent {",
			"  constructor(private stores: NanoSvc) {}",
			"}",
		].join("\n");
		const { sourceFile } = createSourceFile(angularSource, "profile.component.ts");
		const info = collectNanostoresFrameworkImports(sourceFile);

		expect(info.angularServiceNames.has("stores")).toBe(true);
	});

	it("collects effectFns from nanostores base module", () => {
		const code = [
			'import { effect } from "nanostores";',
			'import { effect as watchStores } from "nanostores";',
		].join("\n");
		const { sourceFile } = createSourceFile(code, "side.ts");
		const info = collectNanostoresStoreImports(sourceFile);

		expect(info.effectFns.has("effect")).toBe(true);
		expect(info.effectFns.has("watchStores")).toBe(true);
	});

	it("does not collect effect from non-base modules", () => {
		const code = ['import { effect } from "some-other-lib";'].join("\n");
		const { sourceFile } = createSourceFile(code, "side.ts");
		const info = collectNanostoresStoreImports(sourceFile);

		expect(info.effectFns.size).toBe(0);
	});

	it("does not add effect to storeFactories", () => {
		const code = ['import { effect, atom } from "nanostores";'].join("\n");
		const { sourceFile } = createSourceFile(code, "side.ts");
		const info = collectNanostoresStoreImports(sourceFile);

		expect(info.storeFactories.has("effect")).toBe(false);
		expect(info.storeFactories.get("atom")).toBe("atom");
	});

	it("ignores constructor params without NanostoresService type", () => {
		const angularSource = [
			'import { NanostoresService } from "@nanostores/angular";',
			"",
			"class AppComponent {",
			"  constructor(private http: HttpClient, private ns: NanostoresService) {}",
			"}",
		].join("\n");
		const { sourceFile } = createSourceFile(angularSource, "app.component.ts");
		const info = collectNanostoresFrameworkImports(sourceFile);

		expect(info.angularServiceNames.has("ns")).toBe(true);
		expect(info.angularServiceNames.has("http")).toBe(false);
		expect(info.angularServiceNames.size).toBe(1);
	});
});
