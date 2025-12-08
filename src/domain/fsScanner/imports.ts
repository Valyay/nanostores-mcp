import type { SourceFile } from "ts-morph";
import type { StoreKind } from "./types.js";
import { normalizeStoreKind } from "./types.js";

/**
 * Set of modules from which we consider nanostores store imports.
 * Can be extended at runtime: NANOSTORES_BASE_MODULES.add("my-nanostores-wrapper")
 */
export const NANOSTORES_BASE_MODULES = new Set<string>(["nanostores", "@nanostores/core"]);

export const NANOSTORES_PERSISTENT_MODULES = new Set<string>([
	"@nanostores/persistent",
	"nanostores/persistent",
]);

/**
 * Modules from which we consider useStore() from nanostores/react.
 * Can be extended when needed (e.g., for custom wrappers).
 */
export const NANOSTORES_REACT_MODULES = new Set<string>(["nanostores/react", "@nanostores/react"]);

export interface NanostoresStoreImports {
	storeFactories: Map<string, StoreKind>;
	nanostoresNamespaces: Set<string>;
}

/**
 * Collects information about imported nanostores store factories in a file:
 * - storeFactories: local name → StoreKind
 * - nanostoresNamespaces: local names of namespace imports (import * as ns from "nanostores")
 */
export function collectNanostoresStoreImports(sourceFile: SourceFile): NanostoresStoreImports {
	const storeFactories = new Map<string, StoreKind>();
	const nanostoresNamespaces = new Set<string>();

	for (const imp of sourceFile.getImportDeclarations()) {
		const module = imp.getModuleSpecifierValue();

		// Base stores module
		const isBaseModule = NANOSTORES_BASE_MODULES.has(module);

		// Persistent stores module
		const isPersistentModule = NANOSTORES_PERSISTENT_MODULES.has(module);

		if (!isBaseModule && !isPersistentModule) continue;

		// Named imports: atom, map, computed, persistentAtom, ...
		for (const named of imp.getNamedImports()) {
			const importedName = named.getName();
			const localName = named.getAliasNode()?.getText() ?? importedName;
			const kind = normalizeStoreKind(importedName);

			if (kind !== "unknown") {
				storeFactories.set(localName, kind);
			}
		}

		// Namespace imports: import * as ns from "nanostores"
		if (isBaseModule) {
			const ns = imp.getNamespaceImport();
			if (ns) {
				nanostoresNamespaces.add(ns.getText());
			}
		}
	}

	return { storeFactories, nanostoresNamespaces };
}

export interface NanostoresReactImports {
	useStoreFns: Set<string>;
	reactNamespaces: Set<string>;
}

/**
 * Collects information about imported useStore from nanostores/react:
 * - useStoreFns: local function names (useStore, useNanoStore, ...)
 * - reactNamespaces: namespace imports (import * as nsReact from "nanostores/react")
 */
export function collectNanostoresReactImports(sourceFile: SourceFile): NanostoresReactImports {
	const useStoreFns = new Set<string>();
	const reactNamespaces = new Set<string>();

	for (const imp of sourceFile.getImportDeclarations()) {
		const module = imp.getModuleSpecifierValue();

		if (!NANOSTORES_REACT_MODULES.has(module)) {
			continue;
		}

		// import { useStore, useStore as useNanoStore } from "nanostores/react"
		for (const named of imp.getNamedImports()) {
			const imported = named.getName();
			const local = named.getAliasNode()?.getText() ?? imported;
			if (imported === "useStore") {
				useStoreFns.add(local);
			}
		}

		// import * as nsReact from "nanostores/react"
		const ns = imp.getNamespaceImport();
		if (ns) {
			reactNamespaces.add(ns.getText());
		}
	}

	return { useStoreFns, reactNamespaces };
}
