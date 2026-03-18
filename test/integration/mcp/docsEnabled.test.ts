import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { setupDocsMcpWithDocs, type TestMcpContext } from "./helpers.ts";
import { createDocsFixture } from "../../helpers/fixtures.ts";

/**
 * Tests docs MCP features with actual docs loaded (happy path).
 * Fixture has 3 files: guide/atom.md, api/persistent.md, logger.md
 */

let docsRoot = "";

beforeAll(async () => {
	docsRoot = await createDocsFixture();
});

afterAll(async () => {
	if (docsRoot) {
		await fs.rm(docsRoot, { recursive: true, force: true });
	}
});

async function setup(): Promise<TestMcpContext> {
	return setupDocsMcpWithDocs(docsRoot);
}

// ===========================================================================
// Tools
// ===========================================================================

describe("Tools (docs enabled)", () => {
	describe("nanostores_docs_search", () => {
		it("returns matching results for a valid query", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
				});
				const sc = result.structuredContent as {
					query: string;
					results: Array<{
						pageId: string;
						title: string;
						snippet: string;
						score: number;
					}>;
				};

				expect(sc.query).toBe("atom");
				expect(sc.results.length).toBeGreaterThan(0);
				expect(sc.results[0].pageId).toBeDefined();
				expect(sc.results[0].title).toBeDefined();
				expect(sc.results[0].snippet).toBeDefined();
				expect(sc.results[0].score).toBeGreaterThan(0);
				// Snippets should not contain newlines
				for (const r of sc.results) {
					expect(r.snippet).not.toContain("\n");
				}
				// Text summary should mention results count
				expect(result.text).toContain("results");
			} finally {
				await ctx.cleanup();
			}
		});

		it("respects limit parameter", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
					limit: 1,
				});
				const sc = result.structuredContent as {
					results: unknown[];
				};

				expect(sc.results.length).toBeLessThanOrEqual(1);
			} finally {
				await ctx.cleanup();
			}
		});

		it("filters by tags", async () => {
			const ctx = await setup();
			try {
				// Unfiltered: "atom" appears in both atom and persistent fixture pages
				const unfiltered = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
				});
				const unfilteredSc = unfiltered.structuredContent as {
					results: Array<{ pageId: string }>;
				};

				// Filtered: only pages tagged "persistent"
				const filtered = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
					tags: ["persistent"],
				});
				const filteredSc = filtered.structuredContent as {
					results: Array<{ pageId: string }>;
				};

				// Filter should return fewer or equal results
				expect(filteredSc.results.length).toBeLessThanOrEqual(unfilteredSc.results.length);
				// Filtered results should be a subset of unfiltered results
				const unfilteredIds = new Set(unfilteredSc.results.map(r => r.pageId));
				for (const r of filteredSc.results) {
					expect(unfilteredIds.has(r.pageId)).toBe(true);
				}
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns empty results for non-matching query", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {
					query: "xyznonexistent",
				});
				const sc = result.structuredContent as {
					results: unknown[];
				};

				expect(sc.results).toEqual([]);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_docs_index", () => {
		it("returns all pages and tag aggregation", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_index", {});
				const sc = result.structuredContent as {
					pages: Array<{ id: string; title: string; tags: string[] }>;
					tagAggregation: Array<{ tag: string; count: number }>;
					builtAt: number;
				};

				expect(sc.pages.length).toBeGreaterThanOrEqual(3);
				expect(sc.tagAggregation.length).toBeGreaterThan(0);
				expect(sc.builtAt).toBeGreaterThan(0);

				// Each page should have id, title, and tags
				for (const p of sc.pages) {
					expect(p.id).toBeDefined();
					expect(p.title).toBeDefined();
					expect(p.tags.length).toBeGreaterThan(0);
				}

				// Tag aggregation should have counts
				for (const t of sc.tagAggregation) {
					expect(t.tag).toBeDefined();
					expect(t.count).toBeGreaterThan(0);
				}

				// Text summary should include page listing
				expect(result.text).toContain("Pages:");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_docs_read_page", () => {
		it("returns full page content for a valid page ID", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_read_page", {
					pageId: "guide/atom",
				});
				const sc = result.structuredContent as {
					title: string;
					tags: string[];
					filePath: string;
					content: string;
				};

				expect(sc.title).toBe("Atom Guide");
				expect(sc.tags).toContain("atom");
				expect(sc.filePath).toBeDefined();
				expect(sc.content).toContain("atom");
				// Text should include formatted header
				expect(result.text).toContain("Atom Guide");
			} finally {
				await ctx.cleanup();
			}
		});

		it("throws McpError for non-existent page ID", async () => {
			const ctx = await setup();
			try {
				await expect(
					ctx.callTool("nanostores_docs_read_page", {
						pageId: "non-existent-page",
					}),
				).rejects.toThrow(/Page not found: non-existent-page/);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_docs_for_store", () => {
		it("returns relevant docs for an atom store", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_for_store", {
					storeName: "$counter",
					kindHint: "atom",
				});
				const sc = result.structuredContent as {
					storeName: string;
					kind: string;
					relevantDocs: Array<{
						pageId: string;
						title: string;
						reason: string;
					}>;
				};

				expect(sc.storeName).toBe("$counter");
				expect(sc.kind).toBe("atom");
				expect(sc.relevantDocs.length).toBeGreaterThan(0);
				// Each doc should have reason
				for (const doc of sc.relevantDocs) {
					expect(doc.pageId).toBeDefined();
					expect(doc.title).toBeDefined();
					expect(doc.reason).toContain("Matched query");
				}
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns relevant docs for a persistent store", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_for_store", {
					storeName: "$prefs",
					kindHint: "persistent",
				});
				const sc = result.structuredContent as {
					relevantDocs: Array<{ pageId: string }>;
				};

				expect(sc.relevantDocs.length).toBeGreaterThan(0);
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns results even without kindHint", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_for_store", {
					storeName: "$myStore",
				});
				const sc = result.structuredContent as {
					storeName: string;
					relevantDocs: unknown[];
				};

				expect(sc.storeName).toBe("$myStore");
				// Should still return some results from general query
				expect(sc.relevantDocs).toBeDefined();
			} finally {
				await ctx.cleanup();
			}
		});
	});
});

// ===========================================================================
// Resources
// ===========================================================================

describe("Resources (docs enabled)", () => {
	it("docs index resource returns page listing and JSON", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.readResource("nanostores://docs");

			expect(result.contents.length).toBeGreaterThanOrEqual(2);

			const textContent = result.contents.find(c => c.mimeType === "text/plain");
			expect(textContent?.text).toContain("Pages:");
			expect(textContent?.text).toContain("Atom Guide");

			const jsonContent = result.contents.find(c => c.mimeType === "application/json");
			expect(jsonContent?.text).toBeDefined();
			const index = JSON.parse(jsonContent!.text!);
			expect(index.pages.length).toBeGreaterThanOrEqual(3);
			expect(index.chunks.length).toBeGreaterThan(0);
		} finally {
			await ctx.cleanup();
		}
	});

	it("docs page resource returns full content for page with slash in ID", async () => {
		const ctx = await setup();
		try {
			// guide/atom has a slash — tests URI decoding in the handler
			const result = await ctx.readResource("nanostores://docs/page/guide%2Fatom");

			expect(result.contents.length).toBeGreaterThanOrEqual(2);

			const mdContent = result.contents.find(c => c.mimeType === "text/markdown");
			expect(mdContent?.text).toContain("Atom Guide");

			const jsonContent = result.contents.find(c => c.mimeType === "application/json");
			expect(jsonContent?.text).toBeDefined();
			const data = JSON.parse(jsonContent!.text!);
			expect(data.page.title).toBe("Atom Guide");
			expect(data.chunks.length).toBeGreaterThan(0);
		} finally {
			await ctx.cleanup();
		}
	});

	it("docs page resource returns not-found message for invalid page", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.readResource("nanostores://docs/page/nonexistent");

			expect(result.contents.length).toBeGreaterThanOrEqual(1);
			const textContent = result.contents.find(c => c.mimeType === "text/plain");
			expect(textContent?.text).toContain("Page not found");
		} finally {
			await ctx.cleanup();
		}
	});
});
