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
// Tool: nanostores_docs_search
// ===========================================================================

describe("nanostores_docs_search (docs enabled)", () => {
	describe("query-only mode", () => {
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
				expect(sc.results[0].score).toBeGreaterThan(0);
				for (const r of sc.results) {
					expect(r.snippet).not.toContain("\n");
				}
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
				const sc = result.structuredContent as { results: unknown[] };

				expect(sc.results.length).toBeLessThanOrEqual(1);
			} finally {
				await ctx.cleanup();
			}
		});

		it("filters by tags", async () => {
			const ctx = await setup();
			try {
				const unfiltered = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
				});
				const unfilteredSc = unfiltered.structuredContent as {
					results: Array<{ pageId: string }>;
				};

				const filtered = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
					tags: ["persistent"],
				});
				const filteredSc = filtered.structuredContent as {
					results: Array<{ pageId: string }>;
				};

				expect(filteredSc.results.length).toBeLessThanOrEqual(unfilteredSc.results.length);
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
				const sc = result.structuredContent as { results: unknown[] };

				expect(sc.results).toEqual([]);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("storeKind-only mode", () => {
		it("returns relevant pages for atom storeKind", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {
					storeKind: "atom",
				});
				const sc = result.structuredContent as {
					storeKind: string;
					results: Array<{
						pageId: string;
						title: string;
						snippet: string;
						headingPath: string[];
					}>;
				};

				expect(sc.storeKind).toBe("atom");
				expect(sc.results.length).toBeGreaterThan(0);
				// storeKind results have empty headingPath
				for (const r of sc.results) {
					expect(r.headingPath).toEqual([]);
					expect(r.snippet).toBeDefined();
				}
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("combined query+storeKind mode", () => {
		it("scopes search to store-relevant pages", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
					storeKind: "atom",
				});
				const sc = result.structuredContent as {
					query: string;
					storeKind: string;
					results: Array<{ pageId: string; score: number }>;
				};

				expect(sc.query).toBe("atom");
				expect(sc.storeKind).toBe("atom");
				expect(sc.results.length).toBeGreaterThan(0);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("validation", () => {
		it("returns guidance when neither query nor storeKind provided", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {});
				const sc = result.structuredContent as { results: unknown[] };

				expect(sc.results).toEqual([]);
				expect(result.text).toContain("Provide at least one");
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
