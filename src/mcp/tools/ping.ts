import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const PingInputSchema = z.object({
	message: z.string().default("pong"),
});

const PingOutputSchema = z.object({
	message: z.string(),
});

export function registerPingTool(server: McpServer): void {
	server.registerTool(
		"ping",
		{
			title: "Ping Nanostores MCP server",
			description: "Sanity check: verifies the MCP server is responding",
			inputSchema: PingInputSchema,
			outputSchema: PingOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ message }) => {
			const output = { message };

			return {
				content: [
					{
						type: "text",
						text: `Nanostores MCP server is alive: ${message}`,
					},
				],
				structuredContent: output,
			};
		},
	);
}
