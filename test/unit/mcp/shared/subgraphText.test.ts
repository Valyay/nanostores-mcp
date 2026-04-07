import { describe, expect, it } from "vitest";
import { formatSubgraphText } from "../../../../src/mcp/shared/subgraphText.js";
import type { StoreSubgraphResponse } from "../../../../src/domain/project/summary.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSubgraph(
	overrides: Partial<StoreSubgraphResponse> = {},
): StoreSubgraphResponse {
	return {
		centerStoreId: "store:src/stores.ts#$count",
		radius: 1,
		nodes: [
			{
				id: "store:src/stores.ts#$count",
				type: "store",
				name: "$count",
				kind: "atom",
				file: "src/stores.ts",
			},
		],
		edges: [],
		summary: { nodes: 1, edges: 0 },
		...overrides,
	};
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("formatSubgraphText", () => {
	it("includes center store name and radius in header", () => {
		const subgraph = makeSubgraph();
		const result = formatSubgraphText(subgraph, "$count");
		expect(result).toMatch(/\$count/);
		expect(result).toMatch(/radius=1/);
	});

	it("lists store nodes with their kind", () => {
		const subgraph = makeSubgraph({
			nodes: [
				{
					id: "store:src/stores.ts#$count",
					type: "store",
					name: "$count",
					kind: "atom",
					file: "src/stores.ts",
				},
				{
					id: "store:src/stores.ts#$double",
					type: "store",
					name: "$double",
					kind: "computed",
					file: "src/stores.ts",
				},
			],
			edges: [],
			summary: { nodes: 2, edges: 0 },
		});

		const result = formatSubgraphText(subgraph, "$count");
		expect(result).toMatch(/\[atom\]/);
		expect(result).toMatch(/\[computed\]/);
		expect(result).toMatch(/\$double/);
	});

	it("marks the center store with ← center", () => {
		const subgraph = makeSubgraph();
		const result = formatSubgraphText(subgraph, "$count");
		expect(result).toMatch(/\$count.*←\s*center/);
	});

	it("annotates computed stores with their derives_from source", () => {
		const subgraph = makeSubgraph({
			nodes: [
				{
					id: "store:src/stores.ts#$count",
					type: "store",
					name: "$count",
					kind: "atom",
					file: "src/stores.ts",
				},
				{
					id: "store:src/stores.ts#$double",
					type: "store",
					name: "$double",
					kind: "computed",
					file: "src/stores.ts",
				},
			],
			edges: [
				{
					from: "store:src/stores.ts#$double",
					to: "store:src/stores.ts#$count",
					type: "derives_from",
				},
			],
			summary: { nodes: 2, edges: 1 },
		});

		const result = formatSubgraphText(subgraph, "$count");
		// $double should show it derives from $count
		expect(result).toMatch(/\$double.*derives from \$count/);
	});

	it("lists subscriber files with which stores they subscribe to", () => {
		const subgraph = makeSubgraph({
			nodes: [
				{
					id: "store:src/stores.ts#$count",
					type: "store",
					name: "$count",
					kind: "atom",
					file: "src/stores.ts",
				},
				{
					id: "file:src/components/Counter.tsx",
					type: "file",
					path: "src/components/Counter.tsx",
				},
			],
			edges: [
				{
					from: "file:src/components/Counter.tsx",
					to: "store:src/stores.ts#$count",
					type: "subscribes_to",
				},
			],
			summary: { nodes: 2, edges: 1 },
		});

		const result = formatSubgraphText(subgraph, "$count");
		expect(result).toMatch(/Counter\.tsx/);
		expect(result).toMatch(/\$count/);
		// file section should appear
		expect(result).toMatch(/[Ss]ubscrib/);
	});

	it("appends warning when present", () => {
		const subgraph = makeSubgraph({
			warning: "Subgraph covers 85% of project stores. Consider radius=1.",
		});

		const result = formatSubgraphText(subgraph, "$count");
		expect(result).toMatch(/Warning/i);
		expect(result).toMatch(/85%/);
	});
});
