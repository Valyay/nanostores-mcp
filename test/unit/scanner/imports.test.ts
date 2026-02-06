import { describe, expect, it } from "vitest";
import {
	collectNanostoresReactImports,
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
		const info = collectNanostoresReactImports(sourceFile);

		expect(info.useStoreFns.has("useNanoStore")).toBe(true);
		expect(info.useStoreFns.has("useStore")).toBe(true);
		expect(info.useStoreFns.has("useVueStore")).toBe(false);
		expect(info.useStoreFns.has("useReactStore")).toBe(false);
		expect(info.reactNamespaces.has("nsReact")).toBe(true);
	});
});
