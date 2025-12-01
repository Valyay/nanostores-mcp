import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPingTool } from "./mcp/tools/ping.js";
import { registerScanProjectTool } from "./mcp/tools/scanProject.js";
import { registerStoresResource } from "./mcp/resources/stores.js";
import { registerGraphResource } from "./mcp/resources/graph.js";
import { registerExplainProjectPrompt } from "./mcp/prompts/explainProject.js";

const SERVER_NAME = "nanostores-mcp";
const SERVER_VERSION = "0.1.0";

export function buildNanostoresServer(): McpServer {
	const server = new McpServer({
		name: SERVER_NAME,
		version: SERVER_VERSION,
	});

	// MCP tools
	registerPingTool(server);
	registerScanProjectTool(server);

	// MCP resources
	registerStoresResource(server);
	registerGraphResource(server);

	// MCP prompts
	registerExplainProjectPrompt(server);

	return server;
}
