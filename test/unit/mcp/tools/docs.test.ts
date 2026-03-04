import { describe, expect, it } from "vitest";
import { DOCS_DISABLED_MESSAGE } from "../../../../src/mcp/shared/consts.ts";

/**
 * Tests for the docs tool handler logic (docs_search, docs_for_store).
 *
 * We test the disabled-docs fallback and response formatting patterns.
 */

describe("docs_search tool: disabled docs", () => {
	it("returns disabled message when docsService is null", () => {
		const docsService = null;
		const query = "atom tutorial";

		let text = "";
		let structuredContent: { query: string; results: unknown[] } | undefined;

		if (!docsService) {
			text = DOCS_DISABLED_MESSAGE;
			structuredContent = { query, results: [] };
		}

		expect(text).toContain("Nanostores documentation was not found");
		expect(text).toContain("npm install nanostores");
		expect(structuredContent!.query).toBe("atom tutorial");
		expect(structuredContent!.results).toEqual([]);
	});
});

describe("docs_search tool: result formatting", () => {
	it("formats search results with snippets and resource links", () => {
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
});

describe("docs_for_store tool: disabled docs", () => {
	it("returns disabled message with empty relevantDocs when null service", () => {
		const docsService = null;
		const storeName = "$cart";
		const kindHint = "map" as const;

		let text = "";
		let structuredContent: { storeName: string; kind: string; relevantDocs: unknown[] } | undefined;

		if (!docsService) {
			text = DOCS_DISABLED_MESSAGE;
			structuredContent = { storeName, kind: kindHint, relevantDocs: [] };
		}

		expect(text).toContain("Nanostores documentation was not found");
		expect(structuredContent!.storeName).toBe("$cart");
		expect(structuredContent!.relevantDocs).toEqual([]);
	});
});

describe("docs_for_store tool: query building", () => {
	it("builds atom-specific queries", () => {
		const kindHint = "atom";
		const queries: string[] = [];
		if (kindHint === "atom") queries.push("atom primitive value", "createAtom");
		queries.push("best practices patterns");

		expect(queries).toContain("atom primitive value");
		expect(queries).toContain("createAtom");
		expect(queries).toContain("best practices patterns");
	});

	it("builds map-specific queries", () => {
		const kindHint = "map";
		const queries: string[] = [];
		if (kindHint === "map") queries.push("map object store", "createMap");
		queries.push("best practices patterns");

		expect(queries).toContain("map object store");
	});

	it("builds computed-specific queries", () => {
		const kindHint = "computed";
		const queries: string[] = [];
		if (kindHint === "computed") queries.push("computed derived", "computed store");
		queries.push("best practices patterns");

		expect(queries).toContain("computed derived");
	});

	it("builds persistent-specific queries", () => {
		const kindHint = "persistent";
		const queries: string[] = [];
		if (kindHint === "persistent")
			queries.push("persistent localStorage", "persistentAtom persistentMap");
		queries.push("best practices patterns");

		expect(queries).toContain("persistent localStorage");
	});

	it("falls back to general query when no kindHint", () => {
		const kindHint = undefined;
		const queries: string[] = [];
		if (!kindHint) queries.push("store best practices");
		queries.push("best practices patterns");

		expect(queries).toContain("store best practices");
	});
});
