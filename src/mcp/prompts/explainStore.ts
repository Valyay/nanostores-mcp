// src/mcp/prompts/explainStore.ts
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
				detail_level: z
					.enum(["short", "full"])
					.default("short")
					.describe("Level of detail for the explanation."),
			},
		},
		({ store_name, detail_level }) => {
			const detailInstruction =
				detail_level === "full"
					? "Give a thorough explanation including data shape, derived/computed dependencies, subscribers and typical usage patterns."
					: "Give a concise explanation (2–4 sentences) focusing on what the store represents and how it’s used.";

			// В prompts поддерживаются только роли "user" и "assistant"
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								`You are helping a developer understand a Nanostores store named "${store_name}".`,
								"",
								"Use any available Nanostores MCP resources and tool outputs, in particular:",
								`- nanostores://store/${store_name}  (store details, subscribers, relations; server resolves by name or id)`,
								"- nanostores://graph and nanostores://graph#json (project-wide Nanostores graph)",
								"- results of the `store_summary` tool if provided by the client",
								"",
								"Explain in clear, practical terms:",
								"- What this store represents conceptually in the app domain.",
								"- What kind of store it is (atom, map, computed, derived store).",
								"- How its value is derived from other stores (if it is computed/derived).",
								"- Which components/hooks subscribe to it and why they depend on it.",
								"- Any potential pitfalls or performance considerations related to this store.",
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
