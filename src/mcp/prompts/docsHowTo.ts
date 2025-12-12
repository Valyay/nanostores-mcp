import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { URIS } from "../uris.js";

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
						"What you want to accomplish (for example: 'create a persistent store', 'use computed stores in React').",
					),
			},
		},
		({ task }) => {
			const text = [
				"<ROLE>",
				"You are a senior frontend engineer and Nanostores maintainer.",
				`You are helping a developer learn how to accomplish the following task with Nanostores: "${task}".`,
				"You should produce a concise, practical how-to guide backed by Nanostores documentation.",
				"Write in clear, professional, but friendly language.",
				"</ROLE>",
				"",
				"<ENVIRONMENT>",
				"You are running inside an MCP client.",
				"For this task, you have access to the following tools and resources provided by this server:",
				"",
				"- `nanostores_docs_search` — search over Nanostores documentation (guides, API references, best practices).",
				`- ${URIS.docsPageTemplate} — resources that expose full documentation pages by id.`,
				"",
				"You MAY also use project-aware resources when you need to align your advice with the existing codebase:",
				`- ${URIS.graph} — project-wide Nanostores graph (files, stores, relations).`,
				"- `store_summary` tool — file-level analysis to understand current patterns and store usage.",
				"",
				"Treat these as your primary sources of truth about Nanostores APIs and patterns.",
				"</ENVIRONMENT>",
				"",
				"<RETRIEVAL_INSTRUCTIONS>",
				"Before you start writing the final guide, you SHOULD:",
				"",
				"1. Use `nanostores_docs_search` with the user's task as your query (or a refined variant).",
				"   - Look for pages that contain guides, usage examples, and best practices relevant to this task.",
				"",
				"2. For the most relevant hits, fetch full documentation pages using:",
				`   - ${URIS.docsPageTemplate} — call it with the appropriate page id returned by the search.`,
				'   - Read especially the examples, code snippets, and "best practices" style sections.',
				"",
				'3. If the task clearly relates to an existing project (for example: "migrate current stores to persistent"),',
				"   you MAY look at the project graph and summaries to adapt your advice:",
				`   - Use ${URIS.graph} to see how stores are currently organized.`,
				"   - Use `store_summary` to inspect existing patterns that might influence the solution.",
				"",
				"Do NOT invent APIs or patterns that are not supported by the documentation.",
				"If the documentation does not clearly cover some detail, acknowledge that limitation instead of guessing.",
				"</RETRIEVAL_INSTRUCTIONS>",
				"",
				"<TASK>",
				"Using ONLY the information from Nanostores documentation (and, where relevant, project structure),",
				'write a practical "how-to" guide for this task.',
				"",
				"Your guide MUST:",
				"- Provide a very short summary (TL;DR) of the recommended approach.",
				"- Give a clear, ordered list of steps to achieve the task.",
				"- Include TypeScript (or JavaScript) code examples for the key steps.",
				"- Highlight best practices and common pitfalls from the docs.",
				"- Reference the most relevant documentation pages or sections you used.",
				"",
				'If the task mentions a particular environment or framework (for example, "in React", "in Svelte"),',
				"keep your examples consistent with that context. Otherwise, prefer framework-agnostic examples",
				"that focus on Nanostores usage itself.",
				"</TASK>",
				"",
				"<OUTPUT_FORMAT>",
				"Return a Markdown document with the following structure:",
				"",
				"### TL;DR",
				"- One or two sentences summarizing the recommended approach to this task.",
				"",
				"### Step-by-step guide",
				"",
				"1. **Step 1 – short title**",
				"   - Brief explanation of what happens in this step and why it matters.",
				"   ```typescript",
				"   // Minimal, focused code example demonstrating this step",
				"   ```",
				"",
				"2. **Step 2 – short title**",
				"   - Brief explanation.",
				"   ```typescript",
				"   // Another focused code example",
				"   ```",
				"",
				"3. **Further steps**",
				"   - Add more steps as needed to cover the full task.",
				"",
				"### Best practices",
				"- Key recommendations drawn from the documentation (for example: when to use a particular store kind,",
				"  how to manage subscriptions, how to avoid performance issues).",
				"- Common pitfalls to avoid that are relevant to this task.",
				"",
				"### References",
				"- List the most relevant documentation pages you used.",
				`- For each page, include the documentation id or name (for example, the one used with ${URIS.docsPageTemplate}).`,
				"- If the page data includes a canonical URL, you MAY include that URL as well.",
				"</OUTPUT_FORMAT>",
				"",
				"<QUALITY_GUIDELINES>",
				"- Base all concrete API usage and patterns on the Nanostores documentation you retrieved.",
				"- Prefer the simplest, recommended solution over multiple competing alternatives, unless the docs explicitly present several options.",
				"- Provide code examples that are as close to copy-pasteable as possible (minimal placeholders, clear naming).",
				"- Always explain WHY each step is done, not only HOW to type the code.",
				"- If the task can be approached in multiple ways, briefly mention alternatives but clearly mark which one you recommend.",
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
