import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerBridgeServer } from "../../logger/loggerBridge.js";
import { z } from "zod";

const PingInputSchema = z.object({
	message: z.string().default("pong"),
});

const PingOutputSchema = z.object({
	message: z.string(),
	loggerBridge: z
		.object({
			enabled: z.boolean(),
			url: z.string().optional(),
		})
		.optional(),
});

export function registerPingTool(server: McpServer, loggerBridge?: LoggerBridgeServer): void {
	server.registerTool(
		"ping",
		{
			title: "Ping Nanostores MCP server",
			description:
				"Sanity check: verifies the MCP server is responding. Also reports logger bridge status.",
			inputSchema: PingInputSchema,
			outputSchema: PingOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ message }) => {
			const loggerInfo = loggerBridge?.getInfo();

			const output = {
				message,
				loggerBridge: loggerInfo,
			};

			let text = `Nanostores MCP server is alive: ${message}`;

			if (loggerInfo) {
				text += `\n\nLogger Bridge: ${loggerInfo.enabled ? "enabled" : "disabled"}`;
				if (loggerInfo.url) {
					text += `\nListening on: ${loggerInfo.url}`;
					text += `\nConfigure client to send events to: POST ${loggerInfo.url}/nanostores-logger`;
				}
			}

			return {
				content: [
					{
						type: "text",
						text,
					},
				],
				structuredContent: output,
			};
		},
	);
}
