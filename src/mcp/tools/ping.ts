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
			error: z.string().optional(),
		})
		.optional(),
});

export function buildLoggerBridgeStatusText(loggerInfo?: {
	enabled: boolean;
	url?: string;
	error?: string;
}): string {
	if (!loggerInfo) return "";

	if (loggerInfo.error) {
		return `\n\nLogger Bridge: enabled but not running` + `\nError: ${loggerInfo.error}`;
	}
	if (loggerInfo.url) {
		return (
			`\n\nLogger Bridge: enabled` +
			`\nListening on: ${loggerInfo.url}` +
			`\nConfigure client to send events to: POST ${loggerInfo.url}/nanostores-logger`
		);
	}
	if (!loggerInfo.enabled) {
		return `\n\nLogger Bridge: disabled`;
	}
	return `\n\nLogger Bridge: enabled (starting...)`;
}

export function registerPingTool(server: McpServer, loggerBridge?: LoggerBridgeServer): void {
	server.registerTool(
		"nanostores_ping",
		{
			title: "Ping Nanostores MCP server",
			description:
				"Use this when you need to verify the MCP server is alive or check " +
				"whether the runtime logger bridge is connected.",
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

			const text =
				`Nanostores MCP server is alive: ${message}` + buildLoggerBridgeStatusText(loggerInfo);

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
