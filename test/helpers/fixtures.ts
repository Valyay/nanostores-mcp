import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function toPosix(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

async function createTempDir(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(
	rootDir: string,
	relativePath: string,
	contents: string,
): Promise<void> {
	const filePath = path.join(rootDir, relativePath);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, contents, "utf8");
}

export async function createProjectFixture(): Promise<string> {
	const rootDir = await createTempDir("nanostores-mcp-project-");

	await writeFile(
		rootDir,
		"stores.ts",
		[
			'import { atom, map, computed } from "nanostores";',
			'import { persistentAtom } from "@nanostores/persistent";',
			"",
			"export const $count = atom(0);",
			"export const $cart = map({ items: [] });",
			"export const $total = computed($count, count => count * 2);",
			"export const $bundle = computed([$count, $cart], (count, cart) => count + cart.items.length);",
			'export const $prefs = persistentAtom("prefs", {});',
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"nested/stores.ts",
		['import { atom } from "nanostores";', "", "export const $count = atom(10);", ""].join(
			"\n",
		),
	);

	await writeFile(
		rootDir,
		"components/Counter.tsx",
		[
			'import { useStore } from "nanostores/react";',
			'import { $count, $total } from "../stores";',
			"",
			"export function Counter() {",
			"\tconst count = useStore($count);",
			"\tconst total = useStore($total);",
			"\treturn <div>{count} {total}</div>;",
			"}",
			"",
			"export const useCart = () => {",
			"\treturn useStore($count);",
			"};",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"effects.ts",
		[
			'import { useStore } from "nanostores/react";',
			'import { $cart } from "./stores";',
			"",
			"export function cartEffect() {",
			"\tuseStore($cart);",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/Widget.jsx",
		[
			'import { useStore } from "nanostores/react";',
			'import { $count } from "../stores";',
			"",
			"export function Widget() {",
			"\tconst count = useStore($count);",
			"\treturn <div>{count}</div>;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/PlainWidget.js",
		[
			'import { useStore } from "nanostores/react";',
			'import { $count } from "../stores";',
			"",
			"export function PlainWidget() {",
			"\tconst count = useStore($count);",
			"\treturn count;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/SvelteCounter.ts",
		[
			'import { useStore } from "@nanostores/svelte";',
			'import { $count } from "../stores";',
			"",
			"export function SvelteCounter() {",
			"\tconst count = useStore($count);",
			"\treturn count;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/VueCounter.ts",
		[
			'import { useStore } from "@nanostores/vue";',
			'import { $count } from "../stores";',
			"",
			"export function VueCounter() {",
			"\tconst count = useStore($count);",
			"\treturn count;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/LitCounter.ts",
		[
			'import { useStore } from "@nanostores/lit";',
			'import { $count } from "../stores";',
			"",
			"export function LitCounter() {",
			"\tconst count = useStore($count);",
			"\treturn count;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"stores/extra.mjs",
		['import { atom } from "nanostores";', "", "export const $mjsCount = atom(5);", ""].join(
			"\n",
		),
	);

	await writeFile(
		rootDir,
		"stores/extra.cjs",
		['import { map } from "nanostores";', "", 'export const $cjsCart = map({ items: [] });', ""].join(
			"\n",
		),
	);

	return rootDir;
}

export async function createDocsFixture(): Promise<string> {
	const rootDir = await createTempDir("nanostores-mcp-docs-");

	await writeFile(
		rootDir,
		"guide/atom.md",
		[
			"# Atom Guide",
			"",
			"Atoms are the simplest nanostores.",
			"",
			"```ts",
			"const $count = atom(0);",
			"```",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"api/persistent.md",
		[
			"# Persistent Stores",
			"",
			"Use persistentAtom and persistentMap to keep data across reloads.",
			"",
			"```ts",
			'const $prefs = persistentAtom("prefs", {});',
			"```",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"logger.md",
		[
			"# Logger Integration",
			"",
			"@nanostores/logger streams changes for debugging.",
			"",
		].join("\n"),
	);

	return rootDir;
}

export async function createScannerEdgeCasesFixture(): Promise<string> {
	const rootDir = await createTempDir("nanostores-mcp-edge-");

	await writeFile(
		rootDir,
		"stores/aliases.ts",
		[
			'import { atom as createAtom, map, computed as makeComputed, mapTemplate, computedTemplate, atomFamily } from "nanostores";',
			'import * as ns from "nanostores";',
			'import { persistentMap } from "nanostores/persistent";',
			"",
			"export const $alias = createAtom(1);",
			"export const $map = map({ items: [] });",
			"export const $nsMap = ns.map({ count: 1 });",
			'export const $persist = persistentMap("prefs", { theme: "dark" });',
			"export const $family = atomFamily(id => ({ id }));",
			"export const $template = mapTemplate(id => ({ id }));",
			"export const $computed = makeComputed($alias, value => value + 1);",
			"export const $computedArray = makeComputed([$alias, $nsMap, $alias], (a, b) => a + b.count);",
			"export const $computedTpl = computedTemplate($alias, value => value);",
			"export const $computedNoDeps = makeComputed(() => 1);",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"stores/duplicates.ts",
		['import { atom } from "nanostores";', "", "export const $alias = atom(999);", ""].join(
			"\n",
		),
	);

	await writeFile(
		rootDir,
		"components/AliasComponent.tsx",
		[
			'import { useStore as useNanoStore } from "nanostores/react";',
			'import { $alias, $nsMap, $persist, $computed } from "../stores/aliases";',
			"",
			"export function AliasComponent() {",
			"\tconst a = useNanoStore($alias);",
			"\tconst b = useNanoStore($nsMap);",
			"\tuseNanoStore($persist);",
			"\tuseNanoStore($computed);",
			"\treturn <div>{a}{b}</div>;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"hooks/useDashboard.ts",
		[
			'import * as nanoReact from "nanostores/react";',
			'import { $alias } from "../stores/aliases";',
			"",
			"export const useDashboard = () => {",
			"\treturn nanoReact.useStore($alias);",
			"};",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/ClassCounter.tsx",
		[
			'import { useStore } from "nanostores/react";',
			'import { $alias } from "../stores/aliases";',
			"",
			"export class ClassCounter {",
			"\trender() {",
			"\t\tconst value = useStore($alias);",
			"\t\treturn <div>{value}</div>;",
			"\t}",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"effects/cartEffect.ts",
		[
			'import { useStore } from "nanostores/react";',
			'import { $alias } from "../stores/aliases";',
			"",
			"export function cartEffect() {",
			"\tuseStore($alias);",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/Anon.tsx",
		[
			'import { useStore } from "nanostores/react";',
			'import { $alias } from "../stores/aliases";',
			"",
			"export default function () {",
			"\tuseStore($alias);",
			"\treturn <div />;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/IgnoreArgs.tsx",
		[
			'import { useStore } from "nanostores/react";',
			'import { $alias } from "../stores/aliases";',
			"",
			"export function IgnoreArgs() {",
			"\tuseStore($alias.get());",
			"\tuseStore(getStore());",
			"\treturn null;",
			"}",
			"",
			"function getStore() {",
			"\treturn $alias;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/Ambiguous.tsx",
		[
			'import { useStore } from "nanostores/react";',
			"",
			"const $alias = 123;",
			"",
			"export function Ambiguous() {",
			"\tuseStore($alias);",
			"\treturn null;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"stores/framework.ts",
		['import { atom } from "nanostores";', "", "export const $framework = atom(1);", ""].join(
			"\n",
		),
	);

	await writeFile(
		rootDir,
		"components/ReactUnscoped.tsx",
		[
			'import { useStore } from "nanostores/react";',
			'import { $framework } from "../stores/framework";',
			"",
			"export function ReactUnscoped() {",
			"\tconst value = useStore($framework);",
			"\treturn <div>{value}</div>;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/ReactScoped.tsx",
		[
			'import { useStore } from "@nanostores/react";',
			'import { $framework } from "../stores/framework";',
			"",
			"export function ReactScoped() {",
			"\tconst value = useStore($framework);",
			"\treturn <section>{value}</section>;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/PreactWidget.jsx",
		[
			'import { useStore } from "@nanostores/preact";',
			'import { $framework } from "../stores/framework";',
			"",
			"export function PreactWidget() {",
			"\tconst value = useStore($framework);",
			"\treturn <span>{value}</span>;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/SolidWidget.tsx",
		[
			'import { useStore } from "@nanostores/solid";',
			'import { $framework } from "../stores/framework";',
			"",
			"export function SolidWidget() {",
			"\tconst value = useStore($framework);",
			"\treturn <div>{value}</div>;",
			"}",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/VueWidget.vue",
		[
			"<template>",
			"\t<div>{{ framework }}</div>",
			"</template>",
			"",
			"<script setup>",
			"import { useStore } from '@nanostores/vue'",
			"import { $framework } from '../stores/framework'",
			"",
			"const framework = useStore($framework)",
			"</script>",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/SvelteWidget.svelte",
		[
			"<script>",
			"  import { useStore } from '@nanostores/svelte'",
			"  import { $framework as framework } from '../stores/framework'",
			"",
			"  const value = useStore(framework)",
			"</script>",
			"",
			"<p>{$framework}</p>",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"compat/nanostores.ts",
		[
			'export { atom, map, computed } from "nanostores";',
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"compat/persistent.ts",
		[
			'export { persistentAtom } from "nanostores/persistent";',
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"compat/react.ts",
		[
			'export { useStore } from "nanostores/react";',
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"stores/compat.ts",
		[
			'import { atom as compatAtom, computed as compatComputed } from "../compat/nanostores";',
			'import * as compatNs from "../compat/nanostores";',
			'import { persistentAtom as compatPersistentAtom } from "../compat/persistent";',
			"",
			"export const $compatAtom = compatAtom(1);",
			"export const $compatNsMap = compatNs.map({ count: 2 });",
			'export const $compatPersistent = compatPersistentAtom("compat", {});',
			"export const $compatComputed = compatComputed($compatAtom, value => value + 1);",
			"",
		].join("\n"),
	);

	await writeFile(
		rootDir,
		"components/CompatComponent.tsx",
		[
			'import { useStore as compatUseStore } from "../compat/react";',
			'import * as compatReact from "../compat/react";',
			'import { $compatAtom, $compatComputed } from "../stores/compat";',
			"",
			"export function CompatComponent() {",
			"\tconst value = compatUseStore($compatAtom);",
			"\tconst derived = compatReact.useStore($compatComputed);",
			"\treturn <div>{value}{derived}</div>;",
			"}",
			"",
		].join("\n"),
	);

	return rootDir;
}
