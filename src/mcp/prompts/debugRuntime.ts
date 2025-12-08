import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { suggestStoreNames } from "../shared/storeAutocomplete.js";

/**
 * Prompt: nanostores/debug-store
 * Debug a specific store with both static and runtime analysis
 */
export function registerDebugStorePrompt(server: McpServer): void {
	server.registerPrompt(
		"debug-store",
		{
			title: "Debug a Nanostores store",
			description:
				"Analyze a nanostores store combining static code analysis (AST graph) with runtime behavior (@nanostores/logger events). Find anti-patterns, performance issues, and suggest refactoring.",
			argsSchema: {
				store_name: completable(
					z
						.string()
						.describe(
							"Name of the store to debug (e.g. `$counter`). Autocomplete from project scan.",
						),
					async value => {
						return suggestStoreNames(value);
					},
				),
			},
		},
		({ store_name }) => {
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								`You are helping debug a Nanostores store named "${store_name}".`,
								"",
								"## Available Resources",
								"",
								"Use these MCP resources to gather comprehensive data:",
								"",
								"### Static Analysis (AST/Code Structure)",
								`- nanostores://store/${store_name} - Store definition, file location, type (atom/map/computed), subscribers, relations`,
								"- nanostores://graph - Full project dependency graph",
								"",
								"### Runtime Behavior (Logger Events)",
								`- nanostores://runtime/store/${store_name} - Runtime statistics, recent events, change frequency`,
								"- nanostores://runtime/stats - Overall runtime statistics across all stores",
								"",
								"### Tools",
								`- nanostores_store_activity - Get detailed activity timeline`,
								"- nanostores_find_noisy_stores - Compare against other stores",
								"",
								"## Analysis Framework",
								"",
								"Perform a comprehensive analysis covering:",
								"",
								"### 1. Store Health Check",
								"- Is the store being mounted/used? (check mount events)",
								"- Change frequency: too high (performance issue) or zero (dead code)?",
								"- Action error rate: are there failing operations?",
								"",
								"### 2. Anti-Pattern Detection",
								"- **Too chatty**: Changes triggered too frequently (> 10/sec sustained)",
								"- **Large payload**: Storing large objects that should be normalized",
								"- **Over-subscribed**: Too many components depending on this single store",
								"- **Under-utilized**: Defined but never mounted (dead code)",
								"- **Action chaos**: Many actions modifying the same store without clear ownership",
								"",
								"### 3. Performance Considerations",
								"- Are there unnecessary re-renders due to store changes?",
								"- Could computed stores reduce redundant calculations?",
								"- Should this store be split into multiple smaller stores?",
								"- Are subscribers reading more than they need?",
								"",
								"### 4. Architecture Recommendations",
								"Based on both static structure and runtime behavior, suggest:",
								"- Refactoring opportunities (split store, add computed stores, normalize data)",
								"- Performance optimizations",
								"- Better separation of concerns",
								"- Migration paths if needed",
								"",
								"### 5. Documentation References",
								"Use documentation tools to back up recommendations:",
								"- nanostores_docs_for_store - get official patterns for this store type",
								"- nanostores_docs_search - find best practices for detected issues",
								"- Reference specific doc pages (nanostores://docs/page/{id})",
								"",
								"## Output Format",
								"",
								"Structure your response as:",
								"",
								"1. **Summary**: One-line verdict (healthy / needs attention / critical)",
								"2. **Key Metrics**: Mount count, changes, actions, errors",
								"3. **Issues Found**: List specific problems with severity",
								"4. **Recommendations**: Concrete, actionable steps with code examples",
								"5. **Docs References**: Links to relevant official documentation",
								"",
								"## Important Notes",
								"",
								"- If no runtime data exists, note that logger integration may not be configured",
								"- Compare behavior against similar stores in the project for context",
								"- Consider both dev and production implications",
								"- Back up recommendations with official docs when possible",
							].join("\n"),
						},
					},
				],
			};
		},
	);
}

/**
 * Prompt: nanostores/debug-project-activity
 * Overall runtime health analysis for the entire project
 */
export function registerDebugProjectActivityPrompt(server: McpServer): void {
	server.registerPrompt(
		"debug-project-activity",
		{
			title: "Debug project-wide Nanostores activity",
			description:
				"Analyze runtime behavior across all nanostores in the project. Find hot spots, error patterns, unused stores, and optimization opportunities.",
			argsSchema: {},
		},
		() => {
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								"You are performing a comprehensive runtime analysis of all Nanostores in this project.",
								"",
								"## Available Resources",
								"",
								"### Runtime Data",
								"- nanostores://runtime/stats - Aggregated statistics for all stores",
								"- nanostores://runtime/events - Recent events across all stores",
								"",
								"### Static Structure",
								"- nanostores://graph - Full dependency graph",
								"- nanostores://graph#json - Machine-readable graph data",
								"",
								"### Tools",
								"- nanostores_runtime_overview - Overall health report",
								"- nanostores_find_noisy_stores - Identify high-activity stores",
								"- nanostores_store_activity - Deep dive into specific stores",
								"",
								"## Analysis Goals",
								"",
								"### 1. Identify Hotspots",
								"- Which stores have the highest change frequency?",
								'- Are there "chatty" stores causing performance issues?',
								"- Which stores trigger the most renders?",
								"",
								"### 2. Error Analysis",
								"- Which stores have failing actions?",
								"- Are errors correlated (same root cause)?",
								"- What is the overall error rate?",
								"",
								"### 3. Dead Code Detection",
								"- Which stores are never mounted?",
								"- Are there stores defined but unused?",
								"- Can we safely remove them?",
								"",
								"### 4. Architecture Insights",
								"- Store dependency patterns (centralized vs distributed)",
								"- Are computed stores being used effectively?",
								"- Is there proper separation of concerns?",
								"",
								"### 5. Performance Optimization",
								"- Prioritize: which optimizations have the biggest impact?",
								"- Should stores be normalized differently?",
								"- Are there opportunities for memoization/caching?",
								"",
								"## Output Format",
								"",
								"1. **Executive Summary**",
								"   - Overall health score",
								"   - Number of stores (total, active, problematic)",
								"   - Key findings (3-5 bullet points)",
								"",
								"2. **Priority Issues**",
								"   - List critical problems first",
								"   - Include affected stores and impact",
								"",
								"3. **Detailed Analysis**",
								"   - Hot spots with metrics",
								"   - Error patterns",
								"   - Dead code candidates",
								"",
								"4. **Optimization Roadmap**",
								"   - Ordered by impact (high → low)",
								"   - Concrete action items with effort estimates",
								"   - Back recommendations with official docs (use nanostores_docs_search)",
								"",
								"## Context",
								"",
								"- Focus on actionable insights",
								"- Include specific store names and metrics",
								"- Provide code examples where helpful",
								"- Reference official documentation for best practices",
								"- Consider both immediate fixes and long-term refactoring",
							].join("\n"),
						},
					},
				],
			};
		},
	);
}
