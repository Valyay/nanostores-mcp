import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

function createMockSource(files: Record<string, string>): DocsSource {
	return {
		async listFiles(): Promise<string[]> {
			return Object.keys(files);
		},
		async readFile(filePath: string): Promise<string> {
			return files[filePath];
		},
	};
}

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
			expect(path.isAbsolute(page.id)).toBe(false);
			expect(path.isAbsolute(page.filePath)).toBe(false);
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

	it("returns empty results for empty or single-char query terms", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });

		const empty = await repository.search("");
		expect(empty.hits.length).toBe(0);

		// Single-char terms are filtered out
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

describe("docs domain: service layer", () => {
	it("findForStore returns pages matching atom tags", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nUse atom(0) to create a store.",
			"guide/map.md": "# Map Guide\n\nUse map({}) for objects.",
			"guide/overview.md": "# Overview\n\nNanostores is a state management library.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("atom");
		expect(pages.length).toBeGreaterThan(0);
		expect(pages.every(p => p.tags.some(t => ["atom", "core"].includes(t)))).toBe(true);
	});

	it("findForStore returns pages matching map tags", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nUse atom(0) to create.",
			"guide/map.md": "# Map Guide\n\nUse map({}) for objects.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("map");
		expect(pages.length).toBeGreaterThan(0);
		expect(pages.some(p => p.tags.includes("map"))).toBe(true);
	});

	it("findForStore returns pages matching computed tags", async () => {
		const source = createMockSource({
			"guide/computed.md": "# Computed\n\nUse computed() for derived values.",
			"guide/atom.md": "# Atom Guide\n\nUse atom(0).",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("computed");
		expect(pages.some(p => p.tags.includes("computed"))).toBe(true);
	});

	it("findForStore maps persistentAtom to persistent+atom tags", async () => {
		const source = createMockSource({
			"api/persistent.md":
				"# Persistent Stores\n\nUse persistentAtom and persistentMap for persistence. atom(0)",
			"guide/atom.md": "# Atom Guide\n\nUse atom(0).",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("persistentAtom");
		expect(pages.some(p => p.tags.includes("persistent"))).toBe(true);
	});

	it("findForStore maps persistentMap to persistent+map tags", async () => {
		const source = createMockSource({
			"api/persistent.md":
				"# Persistent Stores\n\nUse persistentAtom and persistentMap for persistence. map({})",
			"guide/map.md": "# Map Guide\n\nUse map({}) for objects.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("persistentMap");
		expect(pages.some(p => p.tags.includes("persistent"))).toBe(true);
	});

	it("findForStore maps atomFamily to atom+family+core tags", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nUse atom(0) for single values.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("atomFamily");
		// Should return pages tagged with atom or core
		expect(pages.length).toBeGreaterThan(0);
		expect(pages.every(p => p.tags.some(t => ["atom", "family", "core"].includes(t)))).toBe(true);
	});

	it("findForStore maps mapTemplate to map+template+core tags", async () => {
		const source = createMockSource({
			"guide/map.md": "# Map Guide\n\nUse map({}) for objects.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("mapTemplate");
		expect(pages.length).toBeGreaterThan(0);
	});

	it("findForStore maps computedTemplate to computed+template+core tags", async () => {
		const source = createMockSource({
			"computed.md": "# Computed\n\nUse computed() for derived values.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("computedTemplate");
		expect(pages.length).toBeGreaterThan(0);
		expect(pages.some(p => p.tags.includes("computed"))).toBe(true);
	});

	it("findForStore maps unknown kind to core tag", async () => {
		const source = createMockSource({
			// No path or content keywords → extractTags defaults to ["core"]
			"overview.md": "# Overview\n\nNanostores is a state management library.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("unknown");
		expect(pages.length).toBeGreaterThan(0);
		expect(pages.every(p => p.tags.includes("core"))).toBe(true);
	});

	it("findForStore sorts pages by number of matching tags descending", async () => {
		// persistentAtom kind → relevant tags ["persistent", "atom"]
		const source = createMockSource({
			// Has both "persistent" and "atom" tags → matches 2 relevant tags
			"persist-atom.md":
				"# Persistent Atom\n\nUse persistentAtom to create a persistent atom(0) store.",
			// Has only "atom" tag → matches 1 relevant tag
			"atom.md": "# Atom Guide\n\nUse atom(0) for single values.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const pages = await service.findForStore("persistentAtom");
		expect(pages.length).toBe(2);
		// persist-atom.md matches 2 tags, atom.md matches 1 → persist-atom first
		expect(pages[0].tags).toContain("persistent");
		expect(pages[0].tags).toContain("atom");
	});

	it("getPage returns null for non-existent page ID", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nContent.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const page = await service.getPage("non-existent");
		expect(page).toBeNull();
	});

	it("getPageChunks returns empty array for non-existent page ID", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nContent.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const chunks = await service.getPageChunks("non-existent");
		expect(chunks).toEqual([]);
	});

	it("getTags returns deduplicated and sorted tags", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nUse atom(0) to create a store.",
			"api/persistent.md": "# Persistent\n\nUse persistentAtom for persistence. atom(0)",
			"logger.md": "# Logger\n\n@nanostores/logger streams changes.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const tags = await service.getTags();
		// Should be sorted alphabetically
		const sorted = [...tags].sort();
		expect(tags).toEqual(sorted);
		// No duplicates
		expect(new Set(tags).size).toBe(tags.length);
	});

	it("search delegates to repository", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nUse atom(0) to create a store.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const result = await service.search("atom");
		expect(result.query).toBe("atom");
		expect(result.hits.length).toBeGreaterThan(0);
	});

	it("getIndex delegates to repository", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nContent.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const service = createDocsService(repository);

		const index = await service.getIndex();
		expect(index.pages.length).toBe(1);
		expect(index.builtAt).toBeGreaterThan(0);
	});
});

describe("docs domain: repository cache", () => {
	it("returns cached index within TTL", async () => {
		let readCount = 0;
		const source: DocsSource = {
			async listFiles(): Promise<string[]> {
				return ["doc.md"];
			},
			async readFile(): Promise<string> {
				readCount++;
				return `# Doc ${readCount}\n\nContent ${readCount}.`;
			},
		};

		const repository = createDocsRepository(source, {
			maxChunkLength: 2000,
			cacheTtlMs: 60_000,
		});

		const first = await repository.getIndex();
		const second = await repository.getIndex();

		// Same object returned from cache
		expect(first).toBe(second);
		// readFile called only once (during first build)
		expect(readCount).toBe(1);
	});

	it("rebuilds index after TTL expires", async () => {
		vi.useFakeTimers();
		try {
			let readCount = 0;
			const source: DocsSource = {
				async listFiles(): Promise<string[]> {
					return ["doc.md"];
				},
				async readFile(): Promise<string> {
					readCount++;
					return `# Doc ${readCount}\n\nContent ${readCount}.`;
				},
			};

			const repository = createDocsRepository(source, {
				maxChunkLength: 2000,
				cacheTtlMs: 1000,
			});

			const first = await repository.getIndex();
			expect(readCount).toBe(1);

			// Advance past TTL
			vi.advanceTimersByTime(1001);

			const second = await repository.getIndex();
			// Cache expired — index was rebuilt from source
			expect(readCount).toBe(2);
			expect(first).not.toBe(second);
		} finally {
			vi.useRealTimers();
		}
	});

	it("respects cacheTtlMs: 0 as immediate expiry", async () => {
		vi.useFakeTimers();
		try {
			let readCount = 0;
			const source: DocsSource = {
				async listFiles(): Promise<string[]> {
					return ["doc.md"];
				},
				async readFile(): Promise<string> {
					readCount++;
					return `# Doc ${readCount}\n\nContent ${readCount}.`;
				},
			};

			// cacheTtlMs: 0 should mean "never cache" (fixed via || → ??)
			const repository = createDocsRepository(source, {
				maxChunkLength: 2000,
				cacheTtlMs: 0,
			});

			await repository.getIndex();
			// Advance by 1ms so Date.now() differs
			vi.advanceTimersByTime(1);
			await repository.getIndex();

			// Both calls should build the index
			expect(readCount).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("getPageById returns undefined for non-existent page", async () => {
		const source: DocsSource = {
			async listFiles(): Promise<string[]> {
				return ["doc.md"];
			},
			async readFile(): Promise<string> {
				return "# Doc\n\nContent.";
			},
		};

		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const page = await repository.getPageById("does-not-exist");
		expect(page).toBeUndefined();
	});

	it("getChunksByPageId returns empty array for non-existent page", async () => {
		const source: DocsSource = {
			async listFiles(): Promise<string[]> {
				return ["doc.md"];
			},
			async readFile(): Promise<string> {
				return "# Doc\n\nContent.";
			},
		};

		const repository = createDocsRepository(source, { maxChunkLength: 2000 });
		const chunks = await repository.getChunksByPageId("does-not-exist");
		expect(chunks).toEqual([]);
	});
});

describe("docs domain: search scoring", () => {
	it("ranks whole-word matches higher than substring matches", async () => {
		const source = createMockSource({
			"standalone.md": "# Atom\n\nThe atom store holds a single value.",
			"compound.md": "# Factories\n\nUse createAtom and atomFamily for dynamic stores.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });

		const result = await repository.search("atom");
		expect(result.hits.length).toBe(2);
		// "standalone.md" has whole-word "atom" occurrences → should rank first
		expect(result.hits[0].page.id).toBe("standalone");
	});

	it("boosts title matches over body matches", async () => {
		const source = createMockSource({
			"titled.md": "# Computed Stores\n\nDerived values from other stores.",
			"body.md": "# Overview\n\nYou can create computed stores with computed().",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });

		const result = await repository.search("computed");
		expect(result.hits.length).toBe(2);
		// Page with "computed" in the title should rank first
		expect(result.hits[0].page.id).toBe("titled");
	});

	it("weights rare terms higher than ubiquitous terms via IDF", async () => {
		const source = createMockSource({
			"common.md": "# Store Guide\n\nEvery store has a value. Store store store.",
			"rare.md": "# Lifecycle\n\nThe onMount hook runs once per store.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });

		// "store" appears in both docs (low IDF), "onMount" only in one (high IDF)
		const result = await repository.search("onMount");
		expect(result.hits.length).toBe(1);
		expect(result.hits[0].page.id).toBe("rare");
	});

	it("normalizes by document length so short focused chunks beat long noisy ones", async () => {
		const source = createMockSource({
			"short.md": "# Atom API\n\natom creates a store.",
			"long.md":
				"# Guide\n\n" +
				"This is a very long introduction. ".repeat(30) +
				"You can also use atom here.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 5000 });

		const result = await repository.search("atom");
		expect(result.hits.length).toBe(2);
		// Short doc with concentrated "atom" usage should rank first
		expect(result.hits[0].page.id).toBe("short");
	});

	it("accepts 2-char query terms and they contribute to score", async () => {
		const source = createMockSource({
			"guide.md": "# Map Store\n\nUse map to store key-value pairs.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });

		const withTwoChar = await repository.search("map to");
		const withoutTwoChar = await repository.search("map");
		expect(withTwoChar.hits.length).toBe(1);
		expect(withoutTwoChar.hits.length).toBe(1);
		// Adding "to" (2 chars) should increase the score beyond "map" alone
		expect(withTwoChar.hits[0].score).toBeGreaterThan(withoutTwoChar.hits[0].score);
	});

	it("computes IDF over full corpus even when tags filter is applied", async () => {
		const source = createMockSource({
			"guide/atom.md": "# Atom Guide\n\nThe atom store holds a single value. atom(0)",
			"guide/map.md": "# Map Guide\n\nThe map store is for objects. map({})",
			"api/logger.md": "# Logger\n\nThe logger streams atom changes for debugging.",
		});
		const repository = createDocsRepository(source, { maxChunkLength: 2000 });

		const unfiltered = await repository.search("atom");
		const filtered = await repository.search("atom", { tags: ["atom"] });

		expect(unfiltered.hits.length).toBeGreaterThan(0);
		expect(filtered.hits.length).toBeGreaterThan(0);

		// Find a chunk that appears in both result sets and verify identical scores
		const filteredTopChunkId = filtered.hits[0].chunk.id;
		const sameChunkInUnfiltered = unfiltered.hits.find(h => h.chunk.id === filteredTopChunkId);
		expect(sameChunkInUnfiltered).toBeDefined();
		expect(filtered.hits[0].score).toBeCloseTo(sameChunkInUnfiltered!.score, 5);
	});
});
