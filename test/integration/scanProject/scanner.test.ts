import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { scanProject } from "../../../src/domain/index.ts";
import { findStore, findSubscriber } from "../../helpers/assertIndex.ts";
import { createProjectFixture, toPosix } from "../../helpers/fixtures.ts";
import { createTempProject } from "../../helpers/tmpProject.ts";

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
			rel =>
				rel.type === "derives_from" && rel.from === totalStore!.id && rel.to === countStore!.id,
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

	it("rejects a file path (not a directory) as root", async () => {
		const filePath = path.join(projectRoot, "stores.ts");
		await expect(scanProject(filePath)).rejects.toThrow(/not a directory/i);
	});

	it("returns empty index for an empty directory", async () => {
		const emptyDir = path.join(projectRoot, "empty-subdir");
		await fs.mkdir(emptyDir, { recursive: true });
		const index = await scanProject(emptyDir);

		expect(index.filesScanned).toBe(0);
		expect(index.stores.length).toBe(0);
		expect(index.subscribers.length).toBe(0);
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
		const svelteSubscriber = findSubscriber(
			index,
			"SvelteWidget",
			"components/SvelteWidget.svelte",
		);

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

describe("scanner domain: snapshot", () => {
	it("produces a stable store/subscriber/relation summary for the fixture project", async () => {
		const index = await scanProject(projectRoot);

		// Normalize paths to POSIX for cross-platform snapshots
		const summary = {
			filesScanned: index.filesScanned,
			storeCount: index.stores.length,
			subscriberCount: index.subscribers.length,
			relationCount: index.relations.length,
			stores: index.stores
				.map(s => ({
					name: s.name,
					kind: s.kind,
					file: toPosix(s.file),
				}))
				.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`)),
			subscribers: index.subscribers
				.map(s => ({
					name: s.name,
					kind: s.kind,
					file: toPosix(s.file),
					storeCount: s.storeIds.length,
				}))
				.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`)),
			relationTypes: {
				declares: index.relations.filter(r => r.type === "declares").length,
				subscribes_to: index.relations.filter(r => r.type === "subscribes_to").length,
				derives_from: index.relations.filter(r => r.type === "derives_from").length,
			},
		};

		expect(summary).toMatchSnapshot();
	});
});

describe("scanner domain: paths with spaces and non-ASCII", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		if (cleanup) {
			await cleanup();
			cleanup = undefined;
		}
	});

	it("scans projects in directories with spaces and unicode characters", async () => {
		const project = await createTempProject(
			{
				"src/stores.ts": [
					'import { atom } from "nanostores";',
					"export const $grüße = atom(0);",
				].join("\n"),
				"src/日本語/stores.ts": [
					'import { atom } from "nanostores";',
					"export const $nihongo = atom(42);",
				].join("\n"),
			},
			"nanostores test ünïcödé-",
		);
		cleanup = project.cleanup;

		const index = await scanProject(project.rootDir);
		const names = index.stores.map(s => s.name);

		expect(names).toContain("$grüße");
		expect(names).toContain("$nihongo");
		expect(index.filesScanned).toBe(2);
	});
});

describe("scanner domain: gitignore", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		if (cleanup) {
			await cleanup();
			cleanup = undefined;
		}
	});

	it("respects .gitignore and excludes matching files", async () => {
		const project = await createTempProject(
			{
				".gitignore": "ignored/\n",
				"src/stores.ts": 'import { atom } from "nanostores";\nexport const $visible = atom(0);',
				"ignored/stores.ts": 'import { atom } from "nanostores";\nexport const $hidden = atom(0);',
			},
			"nanostores-gitignore-",
		);
		cleanup = project.cleanup;

		const index = await scanProject(project.rootDir);
		const storeNames = index.stores.map(store => store.name);

		expect(storeNames).toContain("$visible");
		expect(storeNames).not.toContain("$hidden");
	});
});
