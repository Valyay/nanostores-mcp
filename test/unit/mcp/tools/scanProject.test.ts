import { describe, expect, it } from "vitest";

/**
 * Tests for the scan_project tool handler logic.
 *
 * Since tool handlers are registered as McpServer callbacks, we replicate
 * the core handler logic here (same approach as runtimeResources.test.ts).
 */

interface MockProjectIndex {
	rootDir: string;
	filesScanned: number;
	stores: Array<{ id: string; file: string; line: number; kind: string; name?: string }>;
	subscribers: Array<{
		id: string;
		file: string;
		line: number;
		kind: string;
		name?: string;
		storeIds: string[];
	}>;
	relations: Array<{
		type: "declares" | "subscribes_to" | "derives_from";
		from: string;
		to: string;
		file?: string;
		line?: number;
	}>;
}

/** Mirrors the scan_project handler response building */
function buildScanResponse(
	result: MockProjectIndex | null,
	error?: string,
): { text: string; structuredContent: Record<string, unknown> } {
	const errors: string[] = [];
	let rootToReport = "";
	let filesScanned = 0;
	let stores: MockProjectIndex["stores"] = [];
	let subscribers: MockProjectIndex["subscribers"] = [];
	let relations: MockProjectIndex["relations"] = [];

	if (error) {
		errors.push(`Failed to scan project: ${error}`);
	} else if (result) {
		rootToReport = result.rootDir;
		filesScanned = result.filesScanned;
		stores = result.stores;
		subscribers = result.subscribers;
		relations = result.relations;
	}

	const summaryLines: string[] = [];
	summaryLines.push(`Root: ${rootToReport || "<unknown>"}`);
	summaryLines.push(`Files scanned: ${filesScanned}`);
	summaryLines.push(`Nanostores stores: ${stores.length}`);
	summaryLines.push(`Subscribers (components/hooks/effects): ${subscribers.length}`);
	summaryLines.push(`Relations: ${relations.length}`);

	if (stores.length > 0) {
		const preview = stores.slice(0, 10);
		summaryLines.push("");
		summaryLines.push("First stores:");
		for (const store of preview) {
			const namePart = store.name ? ` ${store.name}` : "";
			summaryLines.push(`- [${store.kind}]${namePart} at ${store.file}:${store.line}`);
		}
	}

	if (subscribers.length > 0) {
		const preview = subscribers.slice(0, 10);
		summaryLines.push("");
		summaryLines.push("First subscribers:");
		for (const sub of preview) {
			const namePart = sub.name ? ` ${sub.name}` : "";
			summaryLines.push(
				`- [${sub.kind}]${namePart} at ${sub.file}:${sub.line} (stores: ${sub.storeIds.length})`,
			);
		}
	}

	if (errors.length > 0) {
		summaryLines.push("");
		summaryLines.push("Errors:");
		for (const e of errors) {
			summaryLines.push(`- ${e}`);
		}
	}

	const structuredContent = {
		root: rootToReport,
		filesScanned,
		stores,
		subscribers,
		relations,
		...(errors.length > 0 ? { errors } : {}),
	};

	return { text: summaryLines.join("\n"), structuredContent };
}

describe("scan_project tool: response building", () => {
	it("builds summary for a successful scan with data", () => {
		const index: MockProjectIndex = {
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
		};

		const { text, structuredContent } = buildScanResponse(index);

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
		const index: MockProjectIndex = {
			rootDir: "/empty",
			filesScanned: 10,
			stores: [],
			subscribers: [],
			relations: [],
		};

		const { text, structuredContent } = buildScanResponse(index);

		expect(text).toContain("Nanostores stores: 0");
		expect(text).not.toContain("First stores:");
		expect(text).not.toContain("First subscribers:");
		expect(structuredContent.errors).toBeUndefined();
	});

	it("builds summary with error message", () => {
		const { text, structuredContent } = buildScanResponse(null, "Directory not found");

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

		const { text } = buildScanResponse({
			rootDir: "/test",
			filesScanned: 1,
			stores,
			subscribers: [],
			relations: [],
		});

		// Should show $s0..$s9 but not $s10..$s14
		expect(text).toContain("$s9");
		expect(text).not.toContain("$s10");
	});

	it("handles store without name", () => {
		const { text } = buildScanResponse({
			rootDir: "/test",
			filesScanned: 1,
			stores: [{ id: "store:a.ts#anon", file: "a.ts", line: 1, kind: "atom" }],
			subscribers: [],
			relations: [],
		});

		expect(text).toContain("[atom] at a.ts:1");
	});
});
