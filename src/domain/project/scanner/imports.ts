import type { SourceFile } from "ts-morph";
import type { ModuleConfig, StoreKind } from "../types.js";
import { normalizeStoreKind } from "../types.js";

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
 * Ecosystem modules that export store factory functions (router, i18n, deepmap).
 * Non-factory exports (openPage, getPath, etc.) are filtered by normalizeStoreKind.
 */
export const NANOSTORES_ECOSYSTEM_MODULES = new Set<string>([
	"@nanostores/router",
	"@nanostores/i18n",
	"@nanostores/deepmap",
]);

/**
 * Framework modules from which we consider useStore() subscriptions.
 * Can be extended when needed (e.g., for custom wrappers).
 */
export const NANOSTORES_FRAMEWORKS_MODULES = new Set<string>([
	"nanostores/react",
	"@nanostores/react",
	"@nanostores/svelte",
	"@nanostores/vue",
	"@nanostores/lit",
	"@nanostores/preact",
	"@nanostores/solid",
]);

export interface NanostoresStoreImports {
	storeFactories: Map<string, StoreKind>;
	nanostoresNamespaces: Set<string>;
}

/**
 * Collects information about imported nanostores store factories in a file:
 * - storeFactories: local name → StoreKind
 * - nanostoresNamespaces: local names of namespace imports (import * as ns from "nanostores")
 */
export function collectNanostoresStoreImports(
	sourceFile: SourceFile,
	moduleConfig?: ModuleConfig,
): NanostoresStoreImports {
	const storeFactories = new Map<string, StoreKind>();
	const nanostoresNamespaces = new Set<string>();

	const baseModules = moduleConfig?.baseModules ?? NANOSTORES_BASE_MODULES;
	const persistentModules = moduleConfig?.persistentModules ?? NANOSTORES_PERSISTENT_MODULES;
	const ecosystemModules = moduleConfig?.ecosystemModules ?? NANOSTORES_ECOSYSTEM_MODULES;

	for (const imp of sourceFile.getImportDeclarations()) {
		const module = imp.getModuleSpecifierValue();

		const isBaseModule = baseModules.has(module);
		const isStoreModule =
			isBaseModule || persistentModules.has(module) || ecosystemModules.has(module);

		if (!isStoreModule) continue;

		// Named imports: atom, map, computed, persistentAtom, createRouter, deepMap, ...
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
 * Collects information about imported useStore from supported modules:
 * - useStoreFns: local function names (useStore, useNanoStore, ...)
 * - reactNamespaces: namespace imports (import * as nsReact from "nanostores/react")
 */
export function collectNanostoresReactImports(
	sourceFile: SourceFile,
	moduleConfig?: ModuleConfig,
): NanostoresReactImports {
	const useStoreFns = new Set<string>();
	const reactNamespaces = new Set<string>();

	const frameworkModules = moduleConfig?.frameworkModules ?? NANOSTORES_FRAMEWORKS_MODULES;

	for (const imp of sourceFile.getImportDeclarations()) {
		const module = imp.getModuleSpecifierValue();

		if (!frameworkModules.has(module)) {
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
