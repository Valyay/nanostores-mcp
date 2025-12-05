import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";

/**
 * Prompt: nanostores/docs-how-to
 * Guide on how to accomplish specific tasks using Nanostores
 */
export function registerDocsHowToPrompt(server: McpServer): void {
	server.registerPrompt(
		"docs-how-to",
		{
			title: "How to do something in Nanostores",
			description:
				"Get step-by-step guidance on accomplishing specific tasks with Nanostores, backed by official documentation.",
			argsSchema: {
				task: z
					.string()
					.describe(
						"What you want to accomplish (e.g., 'create a persistent store', 'use computed stores in React')",
					),
			},
		},
		({ task }) => {
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								`You are helping a developer learn how to: "${task}"`,
								"",
								"## Process",
								"",
								"1. **Search documentation**:",
								"   - Use nanostores_docs_search tool to find relevant docs",
								"   - Look for guides, API references, and best practices",
								"",
								"2. **Read relevant pages**:",
								"   - Use nanostores://docs/page/{id} resources to get full content",
								"   - Focus on examples and code snippets",
								"",
								"3. **Check project context** (if relevant):",
								"   - Use nanostores://graph to see existing stores",
								"   - Use store_summary to understand current patterns",
								"",
								"## Output Format",
								"",
								"### TL;DR",
								"One or two sentences summarizing the approach.",
								"",
								"### Step-by-Step Guide",
								"",
								"1. **First step**",
								"   ```typescript",
								"   // Code example",
								"   ```",
								"",
								"2. **Second step**",
								"   ```typescript",
								"   // Code example",
								"   ```",
								"",
								"### Best Practices",
								"- Key recommendations from docs",
								"- Common pitfalls to avoid",
								"",
								"### References",
								"- Link to relevant doc pages (nanostores://docs/page/...)",
								"- Official URLs if available",
								"",
								"## Important",
								"",
								"- Prioritize official documentation over assumptions",
								"- Provide working code examples",
								"- Explain WHY not just HOW",
								"- Consider the project's existing patterns if applicable",
							].join("\n"),
						},
					},
				],
			};
		},
	);
}
