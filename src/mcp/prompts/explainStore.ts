import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";

import { suggestStoreNames } from "../shared/storeAutocomplete.js";

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
							"Name of the store (for example `$counter`). Autocomplete is based on scanned Nanostores graph.",
						),
					async value => {
						return suggestStoreNames(value);
					},
				),
			},
		},
		({ store_name }) => {
			const detailInstruction =
				"Give a thorough explanation including data shape, derived/computed dependencies, subscribers and typical usage patterns.";

			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								`You are helping a developer understand a Nanostores store named "${store_name}".`,
								"",
								"## Available Resources",
								"",
								"### Project Structure",
								`- nanostores://store/${store_name} - store details, subscribers, relations`,
								"- nanostores://graph - project-wide Nanostores graph",
								"- store_summary tool for file-level analysis",
								"",
								"### Official Documentation",
								"- nanostores_docs_search - search for relevant patterns and best practices",
								"- nanostores_docs_for_store - get docs specific to this store type",
								"- nanostores://docs/page/{id} - read full documentation pages",
								"",
								"## Analysis Steps",
								"",
								"1. **Identify store type and structure**",
								"   - Check nanostores://store/{name} for kind (atom/map/computed)",
								"   - Use nanostores_docs_for_store to get relevant documentation",
								"",
								"2. **Explain core concept**",
								"   - What this store represents in the app domain",
								"   - How its value is structured (primitive, object, derived)",
								"",
								"3. **Show usage patterns**",
								"   - Which components subscribe to it (from graph)",
								"   - How it's typically used (backed by docs)",
								"",
								"4. **Best practices and pitfalls**",
								"   - Reference official docs for recommendations",
								"   - Note any anti-patterns or performance considerations",
								"",
								detailInstruction,
							].join("\n"),
						},
					},
				],
			};
		},
	);
}
