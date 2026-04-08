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
		// No qualitative interpretation — "dead code" claim is left to the LLM
		expect(result).not.toContain("may indicate dead code");
	});

	it("includes runtime diagnostic hints when logger enabled", () => {
		const result = buildInstructions(true, true);
		// Factual: describes what the metric measures, not what it means
		expect(result).toContain("downstream recalculation amplification");
		expect(result).toContain("runtime_coverage");
	});

	it("excludes runtime diagnostic hints when logger disabled", () => {
		const result = buildInstructions(false, false);
		expect(result).not.toContain("downstream recalculation amplification");
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

	it("includes project_outline and scan_project in task routing guidance", () => {
		const result = buildInstructions(false, false);
		// Routing is in request patterns, not a trailing imperative sentence
		expect(result).toContain("nanostores_project_outline");
		expect(result).toContain("nanostores_scan_project");
		// Tool routing is expressed as request pattern → tool sequence
		expect(result).toContain("Request patterns and tool sequences:");
	});

	it("includes task-based tool routing covering key tools", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("Request patterns and tool sequences:");
		expect(result).toContain("nanostores_store_summary");
		expect(result).toContain("nanostores_store_impact");
		expect(result).toContain("nanostores_store_subgraph");
	});

	it("includes runtime tool routing in request patterns when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("nanostores_store_activity");
		expect(enabled).toContain("nanostores_find_noisy_stores");
		expect(enabled).toContain("nanostores_runtime_coverage");
		expect(disabled).not.toContain("runtime events");
	});

	it("includes combined analysis pattern when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("Combined static + runtime analysis pattern:");
		expect(disabled).not.toContain("Combined static + runtime");
	});

	it("analysis directive: combines structural signals with source file reading", () => {
		const result = buildInstructions(false, false);
		// Directive establishes the process: structural hypothesis → source verification → combined finding
		expect(result).toContain("structural signals");
		expect(result).toContain("Read the source file");
		expect(result).toContain("nanostores patterns");
		expect(result).toContain("what the structure reveals, what the source confirms or contradicts");
		// Does not prescribe interpretations or domain categories — LLM interprets from source
		expect(result).not.toContain("Auth / user identity");
		expect(result).not.toContain("Routing / navigation");
	});

	it("request patterns: covers common user intent phrases with tool sequences", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("Request patterns and tool sequences:");
		expect(result).toContain("Analyze / how is state structured?");
		expect(result).toContain("Why does $Component re-render?");
		expect(result).toContain("Is any state unused / dead?");
	});

	it("request patterns: includes performance pattern only when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("Performance / why noisy updates?");
		expect(disabled).not.toContain("Performance / why noisy updates?");
	});

	it("structural signals: includes coOccurringPairs", () => {
		const result = buildInstructions(false, false);
		expect(result).toContain("coOccurringPairs");
	});

	it("analysis directive comes before the tools list", () => {
		const result = buildInstructions(false, false);
		const directivePos = result.indexOf("structural signals");
		const toolsPos = result.indexOf("Available tools:");
		expect(directivePos).toBeLessThan(toolsPos);
	});

	it("includes docs analysis directive when docs enabled", () => {
		const enabled = buildInstructions(false, true);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("nanostores_docs_search");
		expect(enabled).toContain("verify whether the patterns");
		expect(disabled).not.toContain("verify whether the patterns");
	});

	it("includes runtime analysis directive when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("When runtime data is available");
		expect(enabled).toContain("Distinguish externally triggered changes");
		expect(enabled).toContain("actionsErrored > 0");
		expect(disabled).not.toContain("When runtime data is available");
		expect(disabled).not.toContain("Distinguish externally triggered changes");
	});

	it("includes runtime interpretation signals when logger enabled", () => {
		const enabled = buildInstructions(true, false);
		const disabled = buildInstructions(false, false);
		expect(enabled).toContain("mounts > 1 on a module-level store");
		expect(disabled).not.toContain("mounts > 1 on a module-level store");
	});
});
