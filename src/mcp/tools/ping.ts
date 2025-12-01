import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPingTool(server: McpServer): void {
	server.registerTool(
		"ping",
		{
			title: "Ping Nanostores MCP server",
			description: "Sanity check: verifies the MCP server is responding",
			inputSchema: {
				message: z.string().default("pong"),
			},
			outputSchema: {
				message: z.string(),
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
