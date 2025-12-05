import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";

import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

/**
 * Простой кеш имён сторов, чтобы не гонять scanProject на каждое completion.
 */
let cachedRoot: string | null = null;
let cachedStoreNames: string[] = [];

async function getStoreNamesForCurrentRoot(): Promise<string[]> {
	const root = resolveWorkspaceRoot();

	if (cachedRoot === root && cachedStoreNames.length > 0) {
		return cachedStoreNames;
	}

	try {
		const index = await scanProject(root);
		const names = index.stores.map(s => s.name ?? "").filter(n => n.trim().length > 0);

		const unique = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));

		cachedRoot = root;
		cachedStoreNames = unique;

		return unique;
	} catch {
		return cachedStoreNames;
	}
}

async function suggestStoreNames(value: string): Promise<string[]> {
	const allNames = await getStoreNamesForCurrentRoot();

	if (!value.trim()) {
		return allNames.slice(0, 20);
	}

	const q = value.toLowerCase();

	return allNames.filter(name => name.toLowerCase().includes(q)).slice(0, 20);
}

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
