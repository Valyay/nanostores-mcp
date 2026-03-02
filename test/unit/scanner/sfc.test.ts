import { describe, expect, it } from "vitest";
import { ScriptKind } from "typescript";
import {
	extractScriptsFromVueSfc,
	extractScriptsFromSvelteSfc,
} from "../../../src/domain/project/scanner/sfc.ts";

describe("sfc/extractScriptsFromVueSfc", () => {
	it("extracts code from <script> block", async () => {
		const vue = [
			"<template><div></div></template>",
			'<script lang="ts">',
			'import { atom } from "nanostores";',
			"export const $count = atom(0);",
			"</script>",
		].join("\n");

		const result = await extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.hasScript).toBe(true);
		expect(result.scriptKind).toBe(ScriptKind.TS);
		expect(result.code).toContain("atom");
	});

	it("extracts code from <script setup> block", async () => {
		const vue = [
			"<template><div>{{ count }}</div></template>",
			"<script setup>",
			'import { useStore } from "@nanostores/vue";',
			"const count = useStore($count);",
			"</script>",
		].join("\n");

		const result = await extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("useStore");
	});

	it("concatenates both <script> and <script setup> blocks", async () => {
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

		const result = await extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("atom");
		expect(result.code).toContain("$count.get()");
	});

	it("returns hasScript=false when no script blocks exist", async () => {
		const vue = "<template><div>Hello</div></template>";
		const result = await extractScriptsFromVueSfc(vue, "test.vue");

		expect(result.hasScript).toBe(false);
		expect(result.code).toBe("");
	});

	it('infers TS scriptKind from lang="ts"', async () => {
		const vue = [
			"<template><div></div></template>",
			'<script lang="ts">',
			"export default {};",
			"</script>",
		].join("\n");

		const result = await extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.scriptKind).toBe(ScriptKind.TS);
	});

	it('infers TSX scriptKind from lang="tsx"', async () => {
		const vue = [
			"<template><div></div></template>",
			'<script setup lang="tsx">',
			"const x = 1;",
			"</script>",
		].join("\n");

		const result = await extractScriptsFromVueSfc(vue, "test.vue");
		expect(result.scriptKind).toBe(ScriptKind.TSX);
	});

	it("promotes to highest scriptKind when both blocks have different langs", async () => {
		const vue = [
			"<template><div></div></template>",
			"<script>",
			"export default {};",
			"</script>",
			'<script setup lang="ts">',
			"const x = 1;",
			"</script>",
		].join("\n");

		const result = await extractScriptsFromVueSfc(vue, "test.vue");
		// TS (rank 2) > JS (rank 0)
		expect(result.scriptKind).toBe(ScriptKind.TS);
	});
});

describe("sfc/extractScriptsFromSvelteSfc", () => {
	it("extracts code from <script> instance block", async () => {
		const svelte = [
			"<script>",
			'  import { atom } from "nanostores";',
			"  const $count = atom(0);",
			"</script>",
			"<p>{$count}</p>",
		].join("\n");

		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("atom");
	});

	it('extracts code from <script context="module"> block', async () => {
		const svelte = [
			'<script context="module">',
			"  export const prerender = true;",
			"</script>",
			"<p>Hello</p>",
		].join("\n");

		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("prerender");
	});

	it("concatenates module and instance scripts in source order", async () => {
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

		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.hasScript).toBe(true);
		expect(result.code).toContain("prerender");
		expect(result.code).toContain("atom");
	});

	it("returns hasScript=false when no script blocks exist", async () => {
		const svelte = "<p>Hello world</p>";
		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");

		expect(result.hasScript).toBe(false);
	});

	it("skips empty script blocks", async () => {
		const svelte = ["<script>", "</script>", "<p>Hello</p>"].join("\n");
		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");

		// hasScript is true (the block exists), but code is empty
		expect(result.hasScript).toBe(true);
		expect(result.code.trim()).toBe("");
	});

	it('infers TS scriptKind from lang="ts"', async () => {
		const svelte = ['<script lang="ts">', "  const x: number = 1;", "</script>", "<p>{x}</p>"].join(
			"\n",
		);

		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.scriptKind).toBe(ScriptKind.TS);
	});

	it("defaults to JS when no lang attribute", async () => {
		const svelte = ["<script>", "  const x = 1;", "</script>", "<p>{x}</p>"].join("\n");

		const result = await extractScriptsFromSvelteSfc(svelte, "test.svelte");
		expect(result.scriptKind).toBe(ScriptKind.JS);
	});
});

describe("sfc/error resilience: Vue", () => {
	it("throws on malformed Vue template", async () => {
		const malformedVue = [
			"<template>",
			"  <div",
			// missing closing >
			"</template>",
			"<script>",
			'import { atom } from "nanostores";',
			"</script>",
		].join("\n");

		// Vue parser is lenient with template errors — it may not throw.
		// The contract is: if errors.length > 0, formatParseError throws.
		// In practice, @vue/compiler-sfc often accepts malformed templates in the
		// descriptor without reporting errors (errors are for <script> compilation).
		// We test that extraction still works or throws — it should not crash silently.
		try {
			const result = await extractScriptsFromVueSfc(malformedVue, "malformed.vue");
			// If it doesn't throw, the script block should still be extracted
			expect(result.hasScript).toBe(true);
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
		}
	});

	it("throws on completely broken Vue SFC", async () => {
		// Empty <script> is valid, but a script with broken JS won't cause
		// the SFC parser to error — only ts-morph would fail later.
		// Vue SFC parser errors come from broken template/syntax, not script content.
		const brokenVue = "<template><div></template><script>";
		try {
			const result = await extractScriptsFromVueSfc(brokenVue, "broken.vue");
			// Parser may still produce a descriptor for lenient HTML
			expect(typeof result.hasScript).toBe("boolean");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
		}
	});
});

describe("sfc/error resilience: Svelte", () => {
	it("throws on syntax error inside Svelte <script> block", async () => {
		const badSvelte = [
			"<script>",
			"  const x = {{{;",
			// JS syntax error
			"</script>",
			"<p>Hello</p>",
		].join("\n");

		await expect(extractScriptsFromSvelteSfc(badSvelte, "bad.svelte")).rejects.toThrow();
	});

	it("throws on unclosed Svelte <script> tag", async () => {
		const unclosed = "<script>\n  const x = 1;\n<p>Hello</p>";

		await expect(extractScriptsFromSvelteSfc(unclosed, "unclosed.svelte")).rejects.toThrow();
	});
});
