import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { scanProject } from "../../../src/domain/index.ts";
import { findStore, findSubscriber } from "../../helpers/assertIndex.ts";
import { createProjectFixture, toPosix } from "../../helpers/fixtures.ts";

let projectRoot = "";

beforeAll(async () => {
	projectRoot = await createProjectFixture();
});

afterAll(async () => {
	if (projectRoot) {
		await fs.rm(projectRoot, { recursive: true, force: true });
	}
});

describe("scanner domain: scanProject", () => {
	it("finds stores, subscribers, and derived relations", async () => {
		const index = await scanProject(projectRoot);
		const storeNames = index.stores.map(store => store.name);

		expect(storeNames).toContain("$count");
		expect(storeNames).toContain("$cart");
		expect(storeNames).toContain("$total");
		expect(storeNames).toContain("$bundle");
		expect(storeNames).toContain("$prefs");

		const countStore = findStore(index, "$count", "stores.ts");
		const totalStore = findStore(index, "$total", "stores.ts");

		expect(countStore).toBeTruthy();
		expect(totalStore).toBeTruthy();

		const derived = index.relations.find(
			rel => rel.type === "derives_from" && rel.from === totalStore!.id && rel.to === countStore!.id,
		);
		expect(derived).toBeTruthy();

		const counterSubscriber = findSubscriber(index, "Counter");
		expect(counterSubscriber?.kind).toBe("component");
		expect(counterSubscriber?.storeIds).toContain(countStore!.id);

		const hookSubscriber = findSubscriber(index, "useCart");
		expect(hookSubscriber?.kind).toBe("hook");

		const effectSubscriber = findSubscriber(index, "cartEffect");
		expect(effectSubscriber?.kind).toBe("effect");
	});

	it("rejects missing roots with a clear error", async () => {
		const missingRoot = path.join(projectRoot, "missing-root");
		await expect(scanProject(missingRoot)).rejects.toThrow(/does not exist/i);
	});

	it("detects adapter subscribers and extra file formats", async () => {
		const index = await scanProject(projectRoot);

		expect(index.filesScanned).toBe(13);

		const storeNames = index.stores.map(store => store.name);
		expect(storeNames).toContain("$mjsCount");
		expect(storeNames).toContain("$cjsCart");

		const countStore = findStore(index, "$count", "stores.ts");
		expect(countStore).toBeTruthy();

		const svelteSubscriber = findSubscriber(index, "SvelteCounter");
		expect(svelteSubscriber?.kind).toBe("component");
		expect(svelteSubscriber?.storeIds).toContain(countStore!.id);

		const vueSubscriber = findSubscriber(index, "VueCounter");
		expect(vueSubscriber?.kind).toBe("component");
		expect(vueSubscriber?.storeIds).toContain(countStore!.id);

		const litSubscriber = findSubscriber(index, "LitCounter");
		expect(litSubscriber?.kind).toBe("component");
		expect(litSubscriber?.storeIds).toContain(countStore!.id);

		const jsxSubscriber = findSubscriber(index, "Widget");
		expect(jsxSubscriber?.kind).toBe("component");
		expect(jsxSubscriber?.storeIds).toContain(countStore!.id);

		const jsSubscriber = findSubscriber(index, "PlainWidget");
		expect(jsSubscriber?.kind).toBe("component");
		expect(jsSubscriber?.storeIds).toContain(countStore!.id);

		const mjsStore = index.stores.find(store => store.name === "$mjsCount");
		expect(toPosix(mjsStore?.file ?? "")).toBe("stores/extra.mjs");

		const cjsStore = index.stores.find(store => store.name === "$cjsCart");
		expect(toPosix(cjsStore?.file ?? "")).toBe("stores/extra.cjs");
	});

	it("detects subscribers in .vue and .svelte files", async () => {
		const index = await scanProject(projectRoot);

		const countStore = findStore(index, "$count", "stores.ts");
		expect(countStore).toBeTruthy();

		const vueSubscriber = findSubscriber(index, "VueWidget", "components/VueWidget.vue");
		const svelteSubscriber = findSubscriber(index, "SvelteWidget", "components/SvelteWidget.svelte");

		expect(vueSubscriber?.storeIds).toContain(countStore!.id);
		expect(svelteSubscriber?.storeIds).toContain(countStore!.id);
	});

	it("covers all supported source file extensions", async () => {
		const index = await scanProject(projectRoot);

		const extensions = new Set<string>();
		for (const entry of [...index.stores, ...index.subscribers]) {
			const ext = path.extname(entry.file);
			if (ext) extensions.add(ext);
		}

		expect(Array.from(extensions)).toEqual(
			expect.arrayContaining([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"]),
		);
	});
});
