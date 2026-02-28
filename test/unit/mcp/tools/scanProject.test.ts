import { describe, expect, it } from "vitest";
import {
	buildScanProjectResponse,
	type ScanProjectData,
} from "../../../../src/mcp/tools/scanProject.ts";

function makeIndex(overrides: Partial<ScanProjectData> = {}): ScanProjectData {
	return {
		rootDir: "/project",
		filesScanned: 42,
		stores: [
			{ id: "store:src/stores.ts#$counter", file: "src/stores.ts", line: 5, kind: "atom", name: "$counter" },
			{ id: "store:src/stores.ts#$items", file: "src/stores.ts", line: 10, kind: "map", name: "$items" },
		],
		subscribers: [
			{
				id: "subscriber:src/App.tsx#App",
				file: "src/App.tsx",
				line: 8,
				kind: "component",
				name: "App",
				storeIds: ["store:src/stores.ts#$counter"],
			},
		],
		relations: [
			{ type: "declares", from: "file:src/stores.ts", to: "store:src/stores.ts#$counter" },
		],
		...overrides,
	};
}

describe("scan_project tool: response building", () => {
	it("builds summary for a successful scan with data", () => {
		const { content, structuredContent } = buildScanProjectResponse(makeIndex());
		const text = content[0].text;

		expect(text).toContain("Root: /project");
		expect(text).toContain("Files scanned: 42");
		expect(text).toContain("Nanostores stores: 2");
		expect(text).toContain("Subscribers (components/hooks/effects): 1");
		expect(text).toContain("Relations: 1");
		expect(text).toContain("First stores:");
		expect(text).toContain("[atom] $counter at src/stores.ts:5");
		expect(text).toContain("First subscribers:");
		expect(text).toContain("[component] App at src/App.tsx:8 (stores: 1)");

		expect(structuredContent.root).toBe("/project");
		expect(structuredContent.filesScanned).toBe(42);
		expect((structuredContent.stores as unknown[]).length).toBe(2);
		expect(structuredContent.errors).toBeUndefined();
	});

	it("builds summary for an empty project", () => {
		const { content, structuredContent } = buildScanProjectResponse(
			makeIndex({ stores: [], subscribers: [], relations: [] }),
		);
		const text = content[0].text;

		expect(text).toContain("Nanostores stores: 0");
		expect(text).not.toContain("First stores:");
		expect(text).not.toContain("First subscribers:");
		expect(structuredContent.errors).toBeUndefined();
	});

	it("builds summary with error message", () => {
		const { content, structuredContent } = buildScanProjectResponse(null, "Directory not found");
		const text = content[0].text;

		expect(text).toContain("Root: <unknown>");
		expect(text).toContain("Errors:");
		expect(text).toContain("Failed to scan project: Directory not found");
		expect(structuredContent.errors).toEqual(["Failed to scan project: Directory not found"]);
	});

	it("truncates stores preview to first 10", () => {
		const stores = Array.from({ length: 15 }, (_, i) => ({
			id: `store:s.ts#$s${i}`,
			file: "s.ts",
			line: i,
			kind: "atom" as const,
			name: `$s${i}`,
		}));

		const { content } = buildScanProjectResponse(makeIndex({ stores }));
		const text = content[0].text;

		// Should show $s0..$s9 but not $s10..$s14
		expect(text).toContain("$s9");
		expect(text).not.toContain("$s10");
	});

	it("handles store without name", () => {
		const { content } = buildScanProjectResponse(
			makeIndex({
				stores: [{ id: "store:a.ts#anon", file: "a.ts", line: 1, kind: "atom" }],
			}),
		);
		const text = content[0].text;

		expect(text).toContain("[atom] at a.ts:1");
	});
});
