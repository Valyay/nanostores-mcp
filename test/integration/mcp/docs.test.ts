import { describe, expect, it } from "vitest";
import { setupDocsMcp, type TestMcpContext } from "./helpers.ts";

/**
 * Tests docs MCP features with docsService=null (docs disabled).
 * This is the production path when nanostores is not installed or
 * NANOSTORES_DOCS_ROOT is not set.
 */

async function setup(): Promise<TestMcpContext> {
	return setupDocsMcp();
}

// ===========================================================================
// Tools
// ===========================================================================

describe("Tools", () => {
	describe("nanostores_docs_search", () => {
		it("returns empty results with disabled message", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_search", {
					query: "atom",
				});
				const sc = result.structuredContent as {
					query: string;
					results: unknown[];
				};

				expect(sc.query).toBe("atom");
				expect(sc.results).toEqual([]);
				expect(result.text).toContain("documentation was not found");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_docs_for_store", () => {
		it("returns empty relevant docs with disabled message", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_for_store", {
					storeName: "$counter",
					kindHint: "atom",
				});
				const sc = result.structuredContent as {
					storeName: string;
					kind: string;
					relevantDocs: unknown[];
				};

				expect(sc.storeName).toBe("$counter");
				expect(sc.kind).toBe("atom");
				expect(sc.relevantDocs).toEqual([]);
				expect(result.text).toContain("documentation was not found");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_docs_read_page", () => {
		it("returns disabled message when docs service is null", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_read_page", {
					pageId: "guide/atom",
				});
				const sc = result.structuredContent as {
					title: string;
					tags: string[];
					content: string;
				};

				expect(sc.tags).toEqual([]);
				expect(sc.content).toContain("documentation was not found");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_docs_index", () => {
		it("returns empty index with disabled message when docs service is null", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_docs_index", {});
				const sc = result.structuredContent as {
					pages: unknown[];
					tagAggregation: unknown[];
					builtAt: number;
				};

				expect(sc.pages).toEqual([]);
				expect(sc.tagAggregation).toEqual([]);
				expect(sc.builtAt).toBe(0);
				expect(result.text).toContain("documentation was not found");
			} finally {
				await ctx.cleanup();
			}
		});
	});
});

// ===========================================================================
// Resources
// ===========================================================================

describe("Resources", () => {
	it("listResourceTemplates includes docs templates", async () => {
		const ctx = await setup();
		try {
			const templates = await ctx.client.listResourceTemplates();
			const uriTemplates = templates.resourceTemplates.map(t => t.uriTemplate);

			expect(uriTemplates.some(u => u.includes("docs"))).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});

	it("docs index resource returns disabled message", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.readResource("nanostores://docs");

			expect(result.contents.length).toBeGreaterThanOrEqual(1);
			const textContent = result.contents.find(c => c.mimeType === "text/plain");
			expect(textContent?.text).toContain("documentation was not found");
		} finally {
			await ctx.cleanup();
		}
	});
});

// ===========================================================================
// Prompts
// ===========================================================================

describe("Prompts", () => {
	it("listPrompts includes docs-how-to", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.listPrompts();
			const names = result.prompts.map(p => p.name);

			expect(names).toContain("docs-how-to");
		} finally {
			await ctx.cleanup();
		}
	});

	it("docs-how-to prompt returns user message with task context", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.getPrompt({
				name: "docs-how-to",
				arguments: { task: "create a persistent store" },
			});

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].role).toBe("user");

			const content = result.messages[0].content as { type: string; text: string };
			expect(content.type).toBe("text");
			expect(content.text).toContain("create a persistent store");
			expect(content.text).toContain("nanostores_docs_search");
		} finally {
			await ctx.cleanup();
		}
	});
});
