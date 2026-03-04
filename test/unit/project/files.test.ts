import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createTempProject } from "../../helpers/tmpProject.ts";
import {
	discoverSourceFiles,
	getFilesMaxMtime,
} from "../../../src/domain/project/scanner/files.ts";

describe("scanner/files", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	describe("discoverSourceFiles", () => {
		it("finds ts/tsx/js/jsx files", async () => {
			const project = await createTempProject({
				"src/store.ts": "export const $count = atom(0);",
				"src/App.tsx": "export default function App() {}",
				"lib/util.js": "module.exports = {};",
				"lib/hook.jsx": "export function useHook() {}",
			});
			cleanup = project.cleanup;

			const files = await discoverSourceFiles(project.rootDir);
			const names = files.map(f => path.relative(project.rootDir, f)).sort();
			expect(names).toEqual(["lib/hook.jsx", "lib/util.js", "src/App.tsx", "src/store.ts"]);
		});

		it("ignores node_modules and dist", async () => {
			const project = await createTempProject({
				"src/index.ts": "export {};",
				"node_modules/pkg/index.ts": "export {};",
				"dist/index.js": "export {};",
			});
			cleanup = project.cleanup;

			const files = await discoverSourceFiles(project.rootDir);
			const names = files.map(f => path.relative(project.rootDir, f));
			expect(names).toEqual(["src/index.ts"]);
		});
	});

	describe("getFilesMaxMtime", () => {
		it("returns 0 for empty list", async () => {
			expect(await getFilesMaxMtime([])).toBe(0);
		});

		it("returns max mtime across files", async () => {
			const project = await createTempProject({
				"a.ts": "a",
				"b.ts": "b",
			});
			cleanup = project.cleanup;

			const fileA = path.join(project.rootDir, "a.ts");
			const fileB = path.join(project.rootDir, "b.ts");

			// Touch file B to make it newer
			await new Promise(r => setTimeout(r, 50));
			await fs.writeFile(fileB, "b updated");

			const maxMtime = await getFilesMaxMtime([fileA, fileB]);
			const statB = await fs.stat(fileB);
			expect(maxMtime).toBe(statB.mtimeMs);
		});

		it("skips files that cannot be stat'd", async () => {
			const project = await createTempProject({ "a.ts": "a" });
			cleanup = project.cleanup;

			const fileA = path.join(project.rootDir, "a.ts");
			const missing = path.join(project.rootDir, "gone.ts");

			const maxMtime = await getFilesMaxMtime([fileA, missing]);
			const statA = await fs.stat(fileA);
			expect(maxMtime).toBe(statA.mtimeMs);
		});
	});
});
