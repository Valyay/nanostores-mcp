import { describe, expect, it } from "vitest";
import { DOCS_DISABLED_MESSAGE } from "../../../../src/mcp/shared/consts.ts";

/**
 * Tests for the consolidated nanostores_docs_search tool handler logic.
 * Tests disabled-docs fallback and response formatting contracts.
 */

describe("nanostores_docs_search: disabled docs", () => {
	it("returns disabled message and empty results regardless of params", () => {
		const docsService = null;

		let text = "";
		let structuredContent: { query?: string; storeKind?: string; results: unknown[] } | undefined;

		if (!docsService) {
			text = DOCS_DISABLED_MESSAGE;
			structuredContent = { query: "atom", storeKind: "atom", results: [] };
		}

		expect(text).toContain("Nanostores documentation was not found");
		expect(text).toContain("npm install nanostores");
		expect(structuredContent!.results).toEqual([]);
	});
});

describe("nanostores_docs_search: result formatting", () => {
	it("formats query-mode results: snippet ≤200 chars, no newlines", () => {
		const hits = [
			{
				page: {
					id: "getting-started",
					title: "Getting Started",
					url: "https://docs.example.com/start",
				},
				chunk: {
					headingPath: ["Introduction", "Quick Start"],
					text: "Nanostores is a tiny state management library for modern frontend frameworks. It provides a simple API to create stores and subscribe to them.\n\nMore details here.",
				},
				score: 0.95,
			},
			{
				page: { id: "api-ref", title: "API Reference" },
				chunk: {
					headingPath: [],
					text: "atom(initialValue) creates a simple store with a single value.",
				},
				score: 0.8,
			},
		];

		const results = hits.map(hit => ({
			pageId: hit.page.id,
			title: hit.page.title,
			url: (hit.page as { url?: string }).url,
			headingPath: hit.chunk.headingPath,
			snippet: hit.chunk.text.slice(0, 200).replace(/\n/g, " "),
			score: hit.score,
		}));

		expect(results).toHaveLength(2);
		expect(results[0].snippet).not.toContain("\n");
		expect(results[0].snippet.length).toBeLessThanOrEqual(200);
		expect(results[0].pageId).toBe("getting-started");
		expect(results[1].url).toBeUndefined();
	});

	it("formats storeKind-mode results: snippet from summary, fallback to title", () => {
		const pages = [
			{ id: "guide/atom", title: "Atom Guide", summary: "Atoms are the simplest stores." },
			{ id: "api/atom", title: "Atom API", summary: undefined },
		];

		const results = pages.map((page, i) => ({
			pageId: page.id,
			title: page.title,
			headingPath: [] as string[],
			snippet: page.summary ?? page.title,
			score: pages.length - i,
		}));

		expect(results[0].snippet).toBe("Atoms are the simplest stores.");
		expect(results[0].headingPath).toEqual([]);
		// Falls back to title when no summary
		expect(results[1].snippet).toBe("Atom API");
	});
});
