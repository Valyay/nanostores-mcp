import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";

import { suggestStoreNames } from "../shared/storeAutocomplete.js";
import { URIS } from "../uris.js";

export function registerExplainStorePrompt(server: McpServer): void {
	server.registerPrompt(
		"explain-store",
		{
			title: "Explain a Nanostores store",
			description:
				"Explain what a Nanostores store does, how it is used, and how it fits into the project.",
			argsSchema: {
				store_name: completable(
					z
						.string()
						.describe(
							"Name of the store (for example `$counter`). Autocomplete is based on the scanned Nanostores graph.",
						),
					async value => {
						return suggestStoreNames(value);
					},
				),
			},
		},
		({ store_name }) => {
			const text = [
				"<ROLE>",
				`You are a senior frontend engineer and Nanostores maintainer.`,
				`You are helping a developer understand a specific Nanostores store named "${store_name}" in this codebase.`,
				"Write in clear, professional, but friendly language.",
				"</ROLE>",
				"",
				"<ENVIRONMENT>",
				"You are running inside an MCP client.",
				"For this task, you have access to the following MCP resources and tools provided by this server:",
				`- ${URIS.storeById(store_name)} — JSON details for this store (kind, file, definition, relations, subscribers, etc.).`,
				`- ${URIS.graph} — project-wide Nanostores graph (files, stores, relations).`,
				"- `store_summary` tool — file-level analysis and explanation for a given store file.",
				"",
				"These are the ONLY reliable sources of truth about this store and its relations in the current project.",
				"</ENVIRONMENT>",
				"",
				"<RETRIEVAL_INSTRUCTIONS>",
				"Before you start writing the explanation, you MUST:",
				`1. Call the MCP resource with URI "${URIS.storeById(store_name)}" and read its JSON representation (the entry with mimeType "application/json").`,
				"   - If this resource is missing or the store cannot be found, clearly say that the store does not exist in the current graph and suggest checking the name.",
				"2. If the store exists, optionally use the project-wide graph at:",
				`   - ${URIS.graph} — to understand how this store connects to other stores and files.`,
				"3. When you need more context about the file that declares the store, you MAY call the `store_summary` tool for that file.",
				"",
				"Do NOT invent stores, files, folders, or relationships that are not present in these resources.",
				"If some information you would normally want is missing from the resources, explicitly mention that limitation instead of guessing.",
				"</RETRIEVAL_INSTRUCTIONS>",
				"",
				"<GRAPH_ANALYSIS_STEPS>",
				"After loading the store details (and, if helpful, the graph), but BEFORE writing the final answer, mentally perform the following analysis:",
				"- Identify the store kind (atom, map, computed, persistentAtom, persistentMap, etc.) and where it is declared (file path, folder).",
				"- Inspect the store's value shape (primitive vs object, key fields, important nested properties).",
				"- Determine whether this store is derived/computed and what other stores or inputs it depends on.",
				"- Identify main subscribers/consumers of this store from the graph (for example, files, modules, or features that read from or subscribe to it).",
				"- Notice whether this store looks like a core cross-cutting store (used in many places) or a local feature-specific store.",
				"",
				"Use this analysis to drive your explanation, but do NOT output raw intermediate notes or dump full JSON from the resources.",
				"</GRAPH_ANALYSIS_STEPS>",
				"",
				"<TASK>",
				"Using ONLY the information from the available resources, explain this store in a way that will help a developer who is new to the project.",
				"",
				"Your explanation MUST cover:",
				"- What this store represents in the project domain (for example, user session, cart, filters, UI state).",
				"- The data shape of the store's value (fields, important nested properties, typical examples).",
				"- Whether the store is derived/computed, and if so, what inputs or other stores it depends on.",
				"- How and where it is used in the project (key subscribers/consumers, typical interaction patterns).",
				"- How important this store appears to be (for example, core global store vs local feature store).",
				"- Concrete best practices, potential pitfalls, and suggestions for improving naming, structure, or usage, based on idiomatic Nanostores patterns.",
				"",
				"Assume the reader understands the basics of Nanostores, so you do not need to re-explain the library from scratch.",
				"</TASK>",
				"",
				"<OUTPUT_FORMAT>",
				"Return a Markdown document with clear sections. Prefer this structure:",
				`1. \`# ${store_name}\` – one-paragraph overview of what this store represents and why it exists.`,
				"2. `## Location and type` – where the store is declared (file/path) and what kind of store it is.",
				"3. `## Data shape and invariants` – describe the structure of the value and any important invariants.",
				"4. `## Dependencies and relations` – explain derived/computed dependencies and any notable relations to other stores.",
				"5. `## Usage and subscribers` – describe how and where the store is used, grouping subscribers by feature/module when possible.",
				"6. `## Best practices, pitfalls, and improvements` – list concrete recommendations and things to watch out for.",
				"",
				"Guidelines:",
				"- Use headings and bullet points where it improves readability.",
				"- Refer to files as `path/to/file.ts` and stores as `$storeName`.",
				"- Do NOT paste raw JSON from resources; summarize it in human-friendly terms.",
				"- If some aspect cannot be determined from the resources, say so explicitly instead of guessing.",
				"</OUTPUT_FORMAT>",
				"",
				"<QUALITY_GUIDELINES>",
				"- Base all concrete statements about this store ONLY on data from the MCP resources and tools mentioned above.",
				"- It is better to say “the resources do not show X” than to guess or hallucinate missing details.",
				"- Keep the explanation focused on this specific store and its role in the project, not on generic Nanostores theory.",
				"- Aim for a concise but thorough explanation: prioritize clarity, structure, and practical insights.",
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
