import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerExplainProjectPrompt(server: McpServer): void {
	server.registerPrompt(
		"explain-project",
		{
			title: "Explain Nanostores usage in this project",
			description:
				"High-level explanation of how Nanostores is used in the current project, based on nanostores://graph.",
			argsSchema: {
				focus: z
					.string()
					.describe('Optional focus area (e.g. "cart", "auth", "filters", "notifications").')
					.optional(),
				detail: z
					.enum(["overview", "detailed"])
					.describe("Level of detail for the explanation.")
					.default("overview")
					.optional(),
			},
		},
		({ focus, detail }) => {
			const detailLabel = detail ?? "overview";

			const focusText = focus
				? `Focus especially on anything related to "${focus}". If there are multiple relevant stores or files, group them logically and explain how they work together.\n\n`
				: "";

			const text = [
				`You are a senior frontend engineer and Nanostores maintainer.`,
				`Your task is to explain how the Nanostores state management library is used in this project.`,
				``,
				`You are running inside an MCP client that can access the resource "nanostores://graph".`,
				`That resource returns a JSON graph of Nanostores usage in the current workspace with the following structure:`,
				`- rootDir: absolute path of the project root`,
				`- nodes: array of nodes, where each node is either:`,
				`    - { id: "file:src/path.ts", type: "file", path, label }`,
				`    - { id: "store:src/path.ts#$storeName", type: "store", file, kind, name, label }`,
				`- edges: array of edges of the form { from, to, type },`,
				`  where type "declares" means "file declares store".`,
				``,
				`Before you answer, you MUST:`,
				`1. Call the MCP resource with URI "nanostores://graph".`,
				`2. Read its JSON representation (the entry with mimeType "application/json").`,
				`3. Use that JSON graph as the single source of truth about which Nanostores stores exist and where they live.`,
				``,
				`Then, based ONLY on that graph, produce a ${detailLabel} human-readable explanation that covers:`,
				`- Overall layout: which folders/files contain Nanostores stores (e.g. "src/stores", "features/cart/stores", etc.).`,
				`- Key stores and their responsibilities (group related stores together).`,
				`- Distribution of store kinds (atom, map, computed, persistentAtom, persistentMap, etc.) and what that implies about the architecture.`,
				`- Any interesting patterns (e.g. "per-feature store modules", "shared core stores", "UI-only stores").`,
				`- Suggestions for improving structure, naming, or separation of concerns, keeping in mind idiomatic Nanostores usage.`,
				``,
				focusText,
				`Guidelines:`,
				`- Write for a human developer who just joined the project.`,
				`- Use headings and bullet points where it helps readability.`,
				`- Refer to files as \`path/to/file.ts\` and stores as \`$storeName\`.`,
				`- If the graph is empty (no stores), clearly say that Nanostores is not yet used and suggest where and how it could be introduced.`,
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
