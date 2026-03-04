import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	createProjectIndexRepository,
	createProjectAnalysisService,
	createLoggerEventStore,
	createRuntimeAnalysisService,
} from "../../../src/domain/index.ts";
import type { LoggerEventStore } from "../../../src/domain/index.ts";
import { createLoggerBridge } from "../../../src/logger/loggerBridge.ts";
import { createStoreAutocomplete } from "../../../src/mcp/shared/storeAutocomplete.ts";
import { registerStaticFeatures } from "../../../src/features/static/index.ts";
import { registerRuntimeFeatures } from "../../../src/features/runtime/index.ts";
import { registerDocsFeatures } from "../../../src/features/docs/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallToolResult {
	text: string;
	parsed: unknown;
	structuredContent: Record<string, unknown> | undefined;
}

export interface ReadResourceResult {
	contents: Array<{
		uri: string;
		mimeType?: string;
		text?: string;
	}>;
}

export interface TestMcpContext {
	client: Client;
	server: McpServer;
	callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
	readResource: (uri: string) => Promise<ReadResourceResult>;
	cleanup: () => Promise<void>;
}

export interface RuntimeTestMcpContext extends TestMcpContext {
	eventStore: LoggerEventStore;
}

// ---------------------------------------------------------------------------
// Shared wiring: McpServer → InMemoryTransport → Client
// ---------------------------------------------------------------------------

async function connectMcp(server: McpServer): Promise<TestMcpContext> {
	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.1" });

	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
	} catch (err) {
		await client.close().catch(() => undefined);
		await server.close().catch(() => undefined);
		throw err;
	}

	const callTool = async (
		name: string,
		args: Record<string, unknown> = {},
	): Promise<CallToolResult> => {
		const result = await client.callTool({ name, arguments: args });

		// isError means the tool handler threw — surface it as a JS error
		if ("isError" in result && result.isError) {
			const errorText = (result.content as Array<{ type: string; text?: string }>)
				.filter(c => c.type === "text")
				.map(c => c.text ?? "")
				.join("\n");
			throw new Error(`Tool "${name}" returned isError: ${errorText}`);
		}

		const text = (result.content as Array<{ type: string; text?: string }>)
			.filter(c => c.type === "text")
			.map(c => c.text ?? "")
			.join("\n");

		let parsed: unknown = text;
		try {
			parsed = JSON.parse(text);
		} catch {
			// not JSON — keep raw text
		}

		return {
			text,
			parsed,
			structuredContent: result.structuredContent as Record<string, unknown> | undefined,
		};
	};

	const readResource = async (uri: string): Promise<ReadResourceResult> => {
		const result = await client.readResource({ uri });
		return {
			contents: result.contents as ReadResourceResult["contents"],
		};
	};

	const cleanup = async (): Promise<void> => {
		await client.close();
		await server.close();
	};

	return { client, server, callTool, readResource, cleanup };
}

// ---------------------------------------------------------------------------
// Setup factories
// ---------------------------------------------------------------------------

export async function setupStaticMcp(): Promise<TestMcpContext> {
	const repo = createProjectIndexRepository();
	const projectService = createProjectAnalysisService(repo);
	const { suggestStoreNames, resetCache } = createStoreAutocomplete(projectService);

	const server = new McpServer({ name: "nanostores-mcp-test", version: "0.0.1" });
	registerStaticFeatures(server, projectService, suggestStoreNames, resetCache);

	return connectMcp(server);
}

export async function setupRuntimeMcp(): Promise<RuntimeTestMcpContext> {
	const eventStore = createLoggerEventStore(1000);
	const repo = createProjectIndexRepository();
	const projectService = createProjectAnalysisService(repo);
	const runtimeService = createRuntimeAnalysisService(eventStore, projectService);
	// Bridge with enabled=false — no HTTP server, just satisfies getInfo()
	const bridge = createLoggerBridge(eventStore, { enabled: false });
	const { suggestStoreNames } = createStoreAutocomplete(projectService);

	const server = new McpServer({ name: "nanostores-mcp-test", version: "0.0.1" });
	registerRuntimeFeatures(server, runtimeService, bridge, suggestStoreNames);

	const ctx = await connectMcp(server);
	return { ...ctx, eventStore };
}

export async function setupDocsMcp(): Promise<TestMcpContext> {
	const server = new McpServer({ name: "nanostores-mcp-test", version: "0.0.1" });
	// null docsService — tests the "docs disabled" path
	registerDocsFeatures(server, null);

	return connectMcp(server);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function stabilizePaths(text: string, rootDir: string): string {
	return text.replaceAll(rootDir, "<root>");
}
