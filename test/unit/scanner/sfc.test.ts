import { describe, expect, it } from "vitest";
import { ScriptKind } from "typescript";
import {
	extractScriptsFromVueSfc,
	extractScriptsFromSvelteSfc,
} from "../../../src/domain/project/scanner/sfc.ts";

describe("sfc/extractScriptsFromVueSfc", () => {
	it("extracts code from <script> block", () => {
		const vue = [
			"<template><div></div></template>",
			'<script lang="ts">',
			'import { atom } from "nanostores";',
			"export const $count = atom(0);",
			"</script>",
		].join("\n");

		const result = extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.hasScript).toBe(true);
		expect(result.scriptKind).toBe(ScriptKind.TS);
		expect(result.code).toContain("atom");
	});

	it("extracts code from <script setup> block", () => {
		const vue = [
			"<template><div>{{ count }}</div></template>",
			"<script setup>",
			'import { useStore } from "@nanostores/vue";',
			"const count = useStore($count);",
			"</script>",
		].join("\n");

		const result = extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("useStore");
	});

	it("concatenates both <script> and <script setup> blocks", () => {
		const vue = [
			"<template><div></div></template>",
			"<script>",
			'import { atom } from "nanostores";',
			"export const $count = atom(0);",
			"</script>",
			"<script setup>",
			"const x = $count.get();",
			"</script>",
		].join("\n");

		const result = extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("atom");
		expect(result.code).toContain("$count.get()");
	});

	it("returns hasScript=false when no script blocks exist", () => {
		const vue = "<template><div>Hello</div></template>";
		const result = extractScriptsFromVueSfc(vue, "test.vue");

		expect(result.hasScript).toBe(false);
		expect(result.code).toBe("");
	});

	it('infers TS scriptKind from lang="ts"', () => {
		const vue = [
			"<template><div></div></template>",
			'<script lang="ts">',
			"export default {};",
			"</script>",
		].join("\n");

		const result = extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.scriptKind).toBe(ScriptKind.TS);
	});

	it('infers TSX scriptKind from lang="tsx"', () => {
		const vue = [
			"<template><div></div></template>",
			'<script setup lang="tsx">',
			"const x = 1;",
			"</script>",
		].join("\n");

		const result = extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.scriptKind).toBe(ScriptKind.TSX);
	});

	it("promotes to highest scriptKind when both blocks have different langs", () => {
		const vue = [
			"<template><div></div></template>",
			"<script>",
			"export default {};",
			"</script>",
			'<script setup lang="ts">',
			"const x = 1;",
			"</script>",
		].join("\n");

		const result = extractScriptsFromVueSfc(vue, "test.vue");
		// TS (rank 2) > JS (rank 0)
		expect(result.scriptKind).toBe(ScriptKind.TS);
	});
});

describe("sfc/extractScriptsFromSvelteSfc", () => {
	it("extracts code from <script> instance block", () => {
		const svelte = [
			"<script>",
			'  import { atom } from "nanostores";',
			"  const $count = atom(0);",
			"</script>",
			"<p>{$count}</p>",
		].join("\n");

		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("atom");
	});

	it('extracts code from <script context="module"> block', () => {
		const svelte = [
			'<script context="module">',
			"  export const prerender = true;",
			"</script>",
			"<p>Hello</p>",
		].join("\n");

		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("prerender");
	});

	it("concatenates module and instance scripts in source order", () => {
		const svelte = [
			'<script context="module">',
			"  export const prerender = true;",
			"</script>",
			"<script>",
			'  import { atom } from "nanostores";',
			"  const $count = atom(0);",
			"</script>",
			"<p>{$count}</p>",
		].join("\n");

		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("prerender");
		expect(result.code).toContain("atom");
	});

	it("returns hasScript=false when no script blocks exist", () => {
		const svelte = "<p>Hello world</p>";
		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");

		expect(result.hasScript).toBe(false);
	});

	it("skips empty script blocks", () => {
		const svelte = ["<script>", "</script>", "<p>Hello</p>"].join("\n");
		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");

		// hasScript is true (the block exists), but code is empty
		expect(result.hasScript).toBe(true);
		expect(result.code.trim()).toBe("");
	});

	it('infers TS scriptKind from lang="ts"', () => {
		const svelte = ['<script lang="ts">', "  const x: number = 1;", "</script>", "<p>{x}</p>"].join(
			"\n",
		);

		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.scriptKind).toBe(ScriptKind.TS);
	});

	it("defaults to JS when no lang attribute", () => {
		const svelte = ["<script>", "  const x = 1;", "</script>", "<p>{x}</p>"].join("\n");

		const result = extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.scriptKind).toBe(ScriptKind.JS);
	});
});
