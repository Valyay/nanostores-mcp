import { describe, expect, it } from "vitest";
import { aggregateTags } from "../../../../src/mcp/shared/docsHelpers.ts";
import type { DocPage } from "../../../../src/domain/index.ts";

function makePage(id: string, tags: string[]): DocPage {
	return {
		id,
		title: id,
		filePath: `${id}.md`,
		headings: [],
		tags,
	};
}

describe("aggregateTags", () => {
	it("counts tags across pages and sorts by frequency descending", () => {
		const pages = [
			makePage("a", ["atom", "core"]),
			makePage("b", ["atom", "guide"]),
			makePage("c", ["core"]),
		];

		const result = aggregateTags(pages);

		expect(result[0]).toEqual({ tag: "atom", count: 2 });
		expect(result[1]).toEqual({ tag: "core", count: 2 });
		expect(result[2]).toEqual({ tag: "guide", count: 1 });
	});

	it("returns empty array for empty pages", () => {
		expect(aggregateTags([])).toEqual([]);
	});

	it("returns single tag for single page with one tag", () => {
		const pages = [makePage("a", ["atom"])];
		expect(aggregateTags(pages)).toEqual([{ tag: "atom", count: 1 }]);
	});
});
