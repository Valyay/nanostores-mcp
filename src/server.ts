import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPingTool } from "./mcp/tools/ping.js";
import { registerScanProjectTool } from "./mcp/tools/scanProject.js";
import { registerStoreResource } from "./mcp/resources/store.js";
import { registerGraphResource } from "./mcp/resources/graph.js";
import { registerGraphMermaidResource } from "./mcp/resources/graphMermaid.js";
import { registerExplainProjectPrompt } from "./mcp/prompts/explainProject.js";
import { registerStoreSummaryTool } from "./mcp/tools/storeSummary.js";
import { registerExplainStorePrompt } from "./mcp/prompts/explainStore.js";

const SERVER_NAME = "nanostores-mcp";
const SERVER_VERSION = "0.1.0";

export function buildNanostoresServer(): McpServer {
	const server = new McpServer(
		{
			name: SERVER_NAME,
			version: SERVER_VERSION,
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				prompts: {},
			},
		},
	);

	// tools
	registerPingTool(server);
	registerScanProjectTool(server);
	registerStoreSummaryTool(server);

	// resources
	registerStoreResource(server);
	registerGraphResource(server);
	registerGraphMermaidResource(server);

	// prompts
	registerExplainProjectPrompt(server);
	registerExplainStorePrompt(server);

	return server;
}
