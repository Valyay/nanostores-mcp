import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	createDocsRepository,
	createDocsService,
	createFsDocsSource,
} from "../../../src/domain/index.ts";
import type { DocsSource } from "../../../src/domain/docs/sourceFs.ts";
import { createDocsFixture } from "../../helpers/fixtures.ts";

let docsRoot = "";

beforeAll(async () => {
	docsRoot = await createDocsFixture();
});

afterAll(async () => {
	if (docsRoot) {
		await fs.rm(docsRoot, { recursive: true, force: true });
	}
});

describe("docs domain: repository and service", () => {
	it("indexes pages and chunks from the filesystem", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });

		const index = await repository.getIndex();
		expect(index.pages.length).toBeGreaterThanOrEqual(3);
		expect(index.chunks.length).toBeGreaterThanOrEqual(index.pages.length);
		expect(index.builtAt).toBeGreaterThan(0);

		// Page IDs and filePaths must be relative (not absolute)
		for (const page of index.pages) {
			expect(page.id).not.toMatch(/^\//);
			expect(page.filePath).not.toMatch(/^\//);
		}
	});

	it("handles regex special characters in search queries safely", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });

		// These would crash before the regex-escaping fix
		const specialChars = ["(", "\\", ".*", "[]", "atom(", "$count"];
		for (const query of specialChars) {
			const result = await repository.search(query);
			expect(result.hits).toBeDefined();
		}
	});

	it("returns empty results for empty or very short query terms", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });

		const empty = await repository.search("");
		expect(empty.hits.length).toBe(0);

		// All terms < 3 chars are filtered out
		const shortTerms = await repository.search("a b");
		expect(shortTerms.hits.length).toBe(0);
	});

	it("supports search, page lookup, and tag-based discovery", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });
		const service = createDocsService(repository);

		const search = await repository.search("atom");
		expect(search.hits.length).toBeGreaterThan(0);
		expect(search.hits.some(hit => hit.page.title.toLowerCase().includes("atom"))).toBe(true);

		const atomPage = search.hits[0].page;
		const page = await repository.getPageById(atomPage.id);
		expect(page?.title).toBe(atomPage.title);

		const chunks = await repository.getChunksByPageId(atomPage.id);
		expect(chunks.length).toBeGreaterThan(0);

		const persistentPages = await service.findForStore("persistentAtom");
		expect(persistentPages.some(pageItem => pageItem.tags.includes("persistent"))).toBe(true);

		const tags = await service.getTags();
		expect(tags).toContain("atom");
		expect(tags).toContain("persistent");
		expect(tags).toContain("logger");
	});
});

describe("docs domain: edge cases", () => {
	it("produces stable lowercase page IDs from file paths", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });

		const index = await repository.getIndex();
		for (const page of index.pages) {
			// Page IDs should be lowercase and use forward slashes
			expect(page.id).toBe(page.id.toLowerCase());
			expect(page.id).not.toContain("\\");
			// Should not contain file extension
			expect(page.id).not.toMatch(/\.(md|mdx)$/);
		}
	});

	it("builds empty index for an empty directory", async () => {
		const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "nanostores-mcp-emptydocs-"));
		try {
			const source = createFsDocsSource({ rootDir: emptyDir });
			const repository = createDocsRepository(source, { maxChunkLength: 200 });

			const index = await repository.getIndex();
			expect(index.pages.length).toBe(0);
			expect(index.chunks.length).toBe(0);
		} finally {
			await fs.rm(emptyDir, { recursive: true, force: true });
		}
	});

	it("skips unreadable files and builds a partial index", async () => {
		// Create a mock source where one file throws on read
		const mockSource: DocsSource = {
			async listFiles(): Promise<string[]> {
				return ["good.md", "bad.md"];
			},
			async readFile(filePath: string): Promise<string> {
				if (filePath === "bad.md") throw new Error("Permission denied");
				return "# Good Page\n\nContent here.";
			},
		};

		const repository = createDocsRepository(mockSource, { maxChunkLength: 500 });
		const index = await repository.getIndex();

		expect(index.pages.length).toBe(1);
		expect(index.pages[0].title).toBe("Good Page");
	});

	it("handles duplicate titles with distinct page IDs", async () => {
		const mockSource: DocsSource = {
			async listFiles(): Promise<string[]> {
				return ["guide/atom.md", "api/atom.md"];
			},
			async readFile(): Promise<string> {
				return "# Atom\n\nSame title, different path.";
			},
		};

		const repository = createDocsRepository(mockSource, { maxChunkLength: 500 });
		const index = await repository.getIndex();

		expect(index.pages.length).toBe(2);
		expect(index.pages[0].title).toBe("Atom");
		expect(index.pages[1].title).toBe("Atom");
		// IDs derived from path must differ
		expect(index.pages[0].id).not.toBe(index.pages[1].id);
	});
});
