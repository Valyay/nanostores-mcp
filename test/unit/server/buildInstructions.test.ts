import { describe, expect, it } from "vitest";

import { buildInstructions } from "../../../src/server.js";

describe("buildInstructions", () => {
	it("includes diagnostic workflow with cascade amplification", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("cascade amplification");
		expect(result).toContain("fan-in hotspots");
		expect(result).toContain("dead code");
	});

	it("includes runtime hints when logger is enabled", () => {
		const result = buildInstructions(true, true);
		expect(result).toContain("cascade amplification");
		expect(result).toContain("runtime_coverage");
	});

	it("excludes runtime hints when logger is disabled", () => {
		const result = buildInstructions(false, false);
		expect(result).not.toContain("runtime_coverage");
		expect(result).not.toContain("runtime change counts");
	});

	it("includes static analysis tools", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("nanostores_scan_project");
		expect(result).toContain("nanostores_store_summary");
	});

	it("includes runtime tools only when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("nanostores_runtime_overview");
		expect(disabled).not.toContain("nanostores_runtime_overview");
	});

	it("includes docs tools only when docs enabled", () => {
		const enabled = buildInstructions(false, true);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("nanostores_docs_search");
		expect(disabled).not.toContain("nanostores_docs_search");
	});
});
