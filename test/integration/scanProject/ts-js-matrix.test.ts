import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "../../../src/domain/index.ts";
import { createTempProject } from "../../helpers/tmpProject.ts";
import { hasRelation, findStore, findSubscriber } from "../../helpers/assertIndex.ts";
import { toPosix } from "../../helpers/fixtures.ts";

const files = {
	"src/stores.ts": [
		'import { atom, computed } from "nanostores";',
		"export const $count = atom(0);",
		"export const $double = computed($count, value => value * 2);",
	].join("\n"),
	"src/component.tsx": [
		'import { useStore } from "nanostores/react";',
		'import { $count } from "./stores";',
		"export function Widget() {",
		"  useStore($count);",
		"  return null;",
		"}",
	].join("\n"),
	"src/extra.js": 'import { atom } from "nanostores"; export const $js = atom(1);',
	"src/extra.jsx": 'import { atom } from "nanostores"; export const $jsx = atom(2);',
	"src/extra.mjs": 'import { atom } from "nanostores"; export const $mjs = atom(3);',
	"src/extra.cjs": 'import { atom } from "nanostores"; export const $cjs = atom(4);',
	"src/bad.ts": "export const = ",
	"dist/ignored.ts": 'import { atom } from "nanostores"; export const $ignored = atom(0);',
	"node_modules/ignored.ts": 'import { atom } from "nanostores"; export const $ignored = atom(0);',
	"coverage/ignored.ts": 'import { atom } from "nanostores"; export const $ignored = atom(0);',
};

describe("scanProject integration: ts/js matrix", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		if (cleanup) {
			await cleanup();
			cleanup = undefined;
		}
	});

	it("scans supported extensions, skips parse errors, and ignores standard folders", async () => {
		const project = await createTempProject(files, "nanostores-matrix-");
		cleanup = project.cleanup;

		const index = await scanProject(project.rootDir);

		expect(index.filesScanned).toBe(6);
		expect(index.stores.map(store => store.name)).toEqual(
			expect.arrayContaining(["$count", "$double", "$js", "$jsx", "$mjs", "$cjs"]),
		);

		const doubleStore = findStore(index, "$double", "src/stores.ts");
		const countStore = findStore(index, "$count", "src/stores.ts");
		expect(doubleStore).toBeTruthy();
		expect(countStore).toBeTruthy();

		const derived = hasRelation(index, {
			type: "derives_from",
			from: doubleStore!.id,
			to: countStore!.id,
		});
		expect(derived).toBe(true);

		const subscriber = findSubscriber(index, "Widget");
		expect(toPosix(subscriber?.file ?? "")).toBe("src/component.tsx");
		const subscribes = hasRelation(index, {
			type: "subscribes_to",
			from: subscriber!.id,
			to: countStore!.id,
		});
		expect(subscribes).toBe(true);

		expect(index.stores.some(store => store.name === "$ignored")).toBe(false);
	});
});
