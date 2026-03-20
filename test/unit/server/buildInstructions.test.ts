import { describe, expect, it } from "vitest";

import { buildInstructions } from "../../../src/server.js";

describe("buildInstructions", () => {
	it("includes static analysis tools", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("nanostores_scan_project");
		expect(result).toContain("nanostores_store_summary");
		expect(result).toContain("nanostores_project_outline");
		expect(result).toContain("nanostores_store_subgraph");
	});

	it("includes runtime tools only when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("nanostores_runtime_overview");
		expect(enabled).toContain("nanostores_store_activity");
		expect(enabled).toContain("nanostores_find_noisy_stores");
		expect(enabled).toContain("nanostores_runtime_coverage");
		expect(disabled).not.toContain("nanostores_runtime_overview");
	});

	it("includes docs tools only when docs enabled", () => {
		const enabled = buildInstructions(false, true);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("nanostores_docs_search");
		expect(disabled).not.toContain("nanostores_docs_search");
	});

	it("includes diagnostic workflow with chain depth and fan-in hints", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("chain depth");
		expect(result).toContain("fan-in");
		expect(result).toContain("dead code");
	});

	it("includes runtime diagnostic hints when logger enabled", () => {
		const result = buildInstructions(true, true);
		expect(result).toContain("cascade amplification");
		expect(result).toContain("runtime_coverage");
	});

	it("excludes runtime diagnostic hints when logger disabled", () => {
		const result = buildInstructions(false, false);
		expect(result).not.toContain("cascade amplification");
	});

	it("includes follow-up actions with store_summary and source file guidance", () => {
		const result = buildInstructions(true, true);
		expect(result).toContain("nanostores_store_summary");
		expect(result).toContain("nanostores_docs_search");
		expect(result).toContain("Read the source file");
	});

	it("excludes docs follow-up when docs disabled", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("Read the source file");
		expect(result).not.toContain("nanostores_docs_search");
	});

	it("starts with scan_project guidance", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("Start with nanostores_scan_project");
	});
});
