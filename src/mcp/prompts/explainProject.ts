import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { URIS } from "../uris.js";

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
		"explain-project",
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
				`You are running inside an MCP client that can access the resource "${URIS.graph}".`,
				"For this task, treat that resource as your ONLY reliable source of truth about existing Nanostores stores and where they live.",
				"</ENVIRONMENT>",
				"",
				"<GRAPH_SCHEMA>",
				`The resource "${URIS.graph}" returns a JSON graph of Nanostores usage in the current workspace with the following structure:`,
				"- rootDir: absolute path of the project root",
				"- nodes: array of nodes, where each node is either:",
				'    - { id: "file:src/path.ts", type: "file", path, label }',
				'    - { id: "store:src/path.ts#$storeName", type: "store", file, kind, name, label }',
				"- edges: array of edges of the form { from, to, type },",
				'  where type "declares" means "file declares store".',
				"",
				"The graph may include many nodes and edges; do NOT try to list every item one by one if there are dozens of them.",
				"</GRAPH_SCHEMA>",
				"",
				"<RETRIEVAL_INSTRUCTIONS>",
				"Before you start writing the explanation, you MUST:",
				`1. Call the MCP resource with URI "${URIS.graph}".`,
				'2. Read its JSON representation (the entry with mimeType "application/json").',
				"3. Use that JSON graph as the single source of truth about which Nanostores stores exist and in which files they are declared.",
				"",
				"Do NOT invent stores, files, folders, or relationships that are not present in the graph.",
				"If some information you would normally want is missing from the graph, explicitly mention that limitation instead of guessing.",
				"</RETRIEVAL_INSTRUCTIONS>",
				"",
				"<GRAPH_ANALYSIS_STEPS>",
				"After loading the graph, but BEFORE writing the final answer, mentally perform the following analysis:",
				"- Identify the main directories and files that declare stores (group by common path prefixes).",
				"- Count how many stores of each kind exist (atom, map, computed, persistentAtom, persistentMap, etc.).",
				"- Find stores that appear to be central (for example, stores with many incoming or outgoing edges).",
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
