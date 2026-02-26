import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectNanostoresDocsSource } from "../../../src/domain/docs/autodetect.ts";
import { createDocsRepository } from "../../../src/domain/index.ts";

let workspaceRoot = "";

beforeAll(async () => {
	workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanostores-mcp-autodetect-"));

	// Create a fake nanostores package with docs
	const pkgDir = path.join(workspaceRoot, "node_modules", "nanostores");
	const docsDir = path.join(pkgDir, "docs");
	await fs.mkdir(docsDir, { recursive: true });

	await fs.writeFile(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: "nanostores", version: "0.42.0" }),
	);

	await fs.writeFile(
		path.join(docsDir, "guide.md"),
		["# Nanostores Guide", "", "Getting started with nanostores atom stores.", ""].join("\n"),
	);

	await fs.writeFile(
		path.join(docsDir, "api.md"),
		["# API Reference", "", "Use atom() to create a simple store.", ""].join("\n"),
	);

	// Create a fake @nanostores/persistent package
	const persistDir = path.join(workspaceRoot, "node_modules", "@nanostores", "persistent");
	await fs.mkdir(persistDir, { recursive: true });

	await fs.writeFile(
		path.join(persistDir, "package.json"),
		JSON.stringify({ name: "@nanostores/persistent", version: "0.10.0" }),
	);

	await fs.writeFile(
		path.join(persistDir, "README.md"),
		["# Persistent Stores", "", "Use persistentAtom to save data across reloads.", ""].join("\n"),
	);
});

afterAll(async () => {
	if (workspaceRoot) {
		await fs.rm(workspaceRoot, { recursive: true, force: true });
	}
});

describe("detectNanostoresDocsSource", () => {
	it("detects nanostores package in node_modules", () => {
		const result = detectNanostoresDocsSource({
			workspaceRoots: [workspaceRoot],
		});

		expect(result.source).not.toBeNull();
		expect(result.info.kind).toBe("package");
		if (result.info.kind === "package") {
			expect(result.info.packageVersion).toBe("0.42.0");
			expect(result.info.workspaceRoot).toBe(workspaceRoot);
		}
	});

	it("indexes nanostores core and @nanostores/* family", async () => {
		const { source } = detectNanostoresDocsSource({
			workspaceRoots: [workspaceRoot],
		});

		expect(source).not.toBeNull();
		const repository = createDocsRepository(source!, { maxChunkLength: 500 });
		const index = await repository.getIndex();

		// 2 from nanostores/docs/ + 1 from @nanostores/persistent/
		expect(index.pages.length).toBe(3);

		// IDs must be relative, namespaced by package
		for (const page of index.pages) {
			expect(page.id).not.toMatch(/^\//);
			expect(page.filePath).not.toMatch(/^\//);
		}

		const ids = index.pages.map(p => p.id);
		expect(ids).toContain("nanostores/docs/api");
		expect(ids).toContain("nanostores/docs/guide");
		expect(ids).toContain("@nanostores/persistent/readme");
	});

	it("returns kind 'none' when nanostores is not installed", () => {
		const result = detectNanostoresDocsSource({
			workspaceRoots: ["/nonexistent/workspace"],
		});

		expect(result.source).toBeNull();
		expect(result.info.kind).toBe("none");
	});

	it("prefers env override over auto-detection", () => {
		const result = detectNanostoresDocsSource({
			workspaceRoots: [workspaceRoot],
			envDocsRoot: "/custom/docs/root",
			envPatterns: ["*.md"],
		});

		expect(result.source).not.toBeNull();
		expect(result.info.kind).toBe("env");
		if (result.info.kind === "env") {
			expect(result.info.rootDir).toBe("/custom/docs/root");
			expect(result.info.patterns).toEqual(["*.md"]);
		}
	});

	it("indexes README when docs/ subdirectory is absent", async () => {
		// Create a workspace with nanostores but no docs/ subdirectory
		const altRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanostores-mcp-nodocs-"));
		const pkgDir = path.join(altRoot, "node_modules", "nanostores");
		await fs.mkdir(pkgDir, { recursive: true });
		await fs.writeFile(
			path.join(pkgDir, "package.json"),
			JSON.stringify({ name: "nanostores", version: "1.0.0" }),
		);
		await fs.writeFile(path.join(pkgDir, "README.md"), "# Nanostores\n\nA tiny state manager.\n");

		try {
			const result = detectNanostoresDocsSource({
				workspaceRoots: [altRoot],
			});

			expect(result.source).not.toBeNull();
			expect(result.info.kind).toBe("package");
			if (result.info.kind === "package") {
				expect(result.info.packageDir).toBe(pkgDir);
				expect(result.info.patterns).toContain("nanostores/*.md");
			}

			// Verify indexing works and finds the README
			const repository = createDocsRepository(result.source!, { maxChunkLength: 500 });
			const index = await repository.getIndex();
			expect(index.pages.length).toBe(1);
			expect(index.pages[0].id).toBe("nanostores/readme");
		} finally {
			await fs.rm(altRoot, { recursive: true, force: true });
		}
	});
});
