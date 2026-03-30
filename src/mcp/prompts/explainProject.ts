import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOLS, PROMPTS, URIS } from "../uris.js";

const ExplainProjectArgsSchema = {
	focus: z
		.string()
		.describe(
			'Optional focus area in the project (for example: "cart", "auth", "filters", "notifications", "search", "checkout").',
		)
		.optional(),
};

export function registerExplainProjectPrompt(server: McpServer): void {
	server.registerPrompt(
		PROMPTS.explainProject,
		{
			title: "Explain Nanostores usage in this project",
			description: `High-level explanation of how Nanostores is used in the current project, based on ${URIS.graph}.`,
			argsSchema: ExplainProjectArgsSchema,
		},
		({ focus }) => {
			const focusBlock = focus
				? [
						"<FOCUS>",
						`The user provided a focus string: "${focus}".`,
						"Treat it as a hint about a feature, domain, route, or module name.",
						"When you explore the graph, prioritize stores and files that look related to this focus (by path, file name, store name, or folder).",
						"In your final explanation:",
						"- FIRST describe how Nanostores is used around this focus area.",
						"- THEN briefly summarize the rest of the architecture.",
						"</FOCUS>",
					].join("\n")
				: [
						"<FOCUS>",
						"No specific focus area was provided.",
						"Give a general overview of Nanostores usage in the whole project, then highlight the most important areas or patterns you see.",
						"</FOCUS>",
					].join("\n");

			const text = [
				"<ROLE>",
				"You are a senior frontend engineer and Nanostores maintainer.",
				"You are helping a developer who just joined this specific codebase understand how the Nanostores state management library is used here.",
				"Write in clear, professional, but friendly language.",
				"</ROLE>",
				"",
				"<ENVIRONMENT>",
				"You have access to the following tools and resources for this task:",
				`- \`${TOOLS.projectOutline}\` — lightweight summary: store counts, kind distribution, top directories, hub stores with subscriber/derived breakdown, and dead stores. Always start here.`,
				`- \`${TOOLS.storeSummary}\` — direct neighbors of a specific store: what it derives from, what depends on it, and who subscribes to it.`,
				`- \`${URIS.graph}\` (MCP resource) — full graph with every store, subscriber, and relation. Use only if you need to reference stores that are not covered by the above tools.`,
				"</ENVIRONMENT>",
				"",
				"<RETRIEVAL_INSTRUCTIONS>",
				"Before you start writing the explanation, follow this sequence:",
				`1. Call \`${TOOLS.projectOutline}\` — get totals, kind distribution, hub stores (with subscriber and derived counts), dead stores, and top directories.`,
				`2. For each hub store (top 3–5 by score), call \`${TOOLS.storeSummary}\` — understand their direct neighbors and subscriber context.`,
				`3. Only if you need store details that are not hubs and not visible from the outline, call the MCP resource \`${URIS.graph}\` for the full store list.`,
				"",
				"Use only the data you collect as the source of truth. Do NOT invent stores, files, or relationships.",
				"If some information is missing, explicitly mention that limitation instead of guessing.",
				"</RETRIEVAL_INSTRUCTIONS>",
				"",
				"<GRAPH_ANALYSIS_STEPS>",
				"After collecting data, but BEFORE writing the final answer, mentally perform the following analysis:",
				"- Identify the main directories and files that declare stores (group by common path prefixes, use topDirs from outline).",
				"- Count how many stores of each kind exist (use storeKinds from outline).",
				"- Understand the most connected stores and their role (use hubs from outline + store_summary for each hub).",
				"- Note any dead stores — they may indicate stale code or missing wiring.",
				"- Notice any feature-style groupings based on paths (for example, stores under `features/*`, `entities/*`, `shared/*`).",
				"",
				"Use this analysis to drive your explanation, but do NOT output raw intermediate notes or the full graph.",
				"</GRAPH_ANALYSIS_STEPS>",
				"",
				focusBlock,
				"",
				"<TASK>",
				"Using ONLY the information from the graph, write a high-level explanation of how Nanostores is used in this project.",
				"",
				"Your explanation should cover:",
				"- Overall layout: which folders/files contain Nanostores stores (for example: `src/stores`, `features/cart/stores`, etc.).",
				"- Key stores and their responsibilities (group related stores together by feature/domain/module).",
				"- Distribution of store kinds (atom, map, computed, persistentAtom, persistentMap, etc.) and what this implies about the architecture.",
				"- Any interesting patterns (for example: per-feature store modules, shared core stores, UI-only stores, cross-cutting concerns).",
				"- Concrete, actionable suggestions for improving structure, naming, or separation of concerns, keeping in mind idiomatic Nanostores usage.",
				"</TASK>",
				"",
				"<OUTPUT_FORMAT>",
				"Return a Markdown document with clear sections. Prefer this structure:",
				"1. `# Nanostores in this project` – short overview (3–5 sentences).",
				"2. `## Where stores live` – describe the main folders and files that declare stores.",
				"3. `## Key stores and responsibilities` – group stores by feature or domain; highlight the most important ones.",
				"4. `## Store kinds and patterns` – describe how different store kinds are used and what this says about the architecture.",
				"5. `## Observations and opportunities` – list concrete suggestions for improvements or cleanups.",
				"",
				"Guidelines:",
				"- Write for a human developer who just joined the project.",
				"- Use headings and bullet points where it improves readability.",
				"- Refer to files as `path/to/file.ts` and stores as `$storeName`.",
				"- Do NOT paste the raw JSON graph; summarize it instead.",
				"- If there are many stores, summarize patterns and give a few representative examples instead of listing everything.",
				"</OUTPUT_FORMAT>",
				"",
				"<QUALITY_GUIDELINES>",
				"- Base concrete statements about files and stores ONLY on the graph data.",
				"- It is better to say “the graph does not show X” than to guess or hallucinate missing details.",
				"- If the graph is empty (no stores), clearly say that Nanostores does not appear to be used yet.",
				"- In that case, briefly suggest where and how Nanostores could be introduced in a typical frontend project, but keep this part short.",
				"- Aim for a concise explanation: prioritize clarity and structure over length.",
				"</QUALITY_GUIDELINES>",
			].join("\n");

			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text,
						},
					},
				],
			};
		},
	);
}
