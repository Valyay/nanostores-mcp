import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerClearCacheTool } from "../../../../src/mcp/tools/clearCache.ts";
import type { ProjectAnalysisService } from "../../../../src/domain/index.ts";
import { setClientRoots, resetForTesting } from "../../../../src/config/settings.ts";

function createMockProjectService(): ProjectAnalysisService {
	return {
		getIndex: vi.fn(),
		getStoreByKey: vi.fn(),
		getStoreNeighbors: vi.fn(),
		getStoreNames: vi.fn(),
		findStoreByRuntimeKey: vi.fn(),
		clearCache: vi.fn(),
	} as unknown as ProjectAnalysisService;
}

async function setupClearCacheTool(): Promise<{
	client: Client;
	server: McpServer;
	projectService: ProjectAnalysisService;
	resetAutocompleteCache: ReturnType<typeof vi.fn>;
	cleanup: () => Promise<void>;
}> {
	const projectService = createMockProjectService();
	const resetAutocompleteCache = vi.fn();

	const server = new McpServer({ name: "test", version: "0.0.0" });
	registerClearCacheTool(server, projectService, resetAutocompleteCache);

	const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.1" });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return {
		client,
		server,
		projectService,
		resetAutocompleteCache,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}

describe("clear_cache tool", () => {
	it("clears all roots when no rootUri provided", async () => {
		const ctx = await setupClearCacheTool();
		try {
			const result = await ctx.client.callTool({
				name: "nanostores_clear_cache",
				arguments: {},
			});

			expect(ctx.projectService.clearCache).toHaveBeenCalledWith();
			expect(ctx.resetAutocompleteCache).toHaveBeenCalledOnce();

			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("all roots");
		} finally {
			await ctx.cleanup();
		}
	});

	it("clears specific root when rootUri provided", async () => {
		resetForTesting();
		setClientRoots([{ uri: "file:///workspace" }]);

		const ctx = await setupClearCacheTool();
		try {
			const result = await ctx.client.callTool({
				name: "nanostores_clear_cache",
				arguments: { rootUri: "/workspace" },
			});

			expect(ctx.projectService.clearCache).toHaveBeenCalledWith(expect.any(String));
			expect(ctx.resetAutocompleteCache).toHaveBeenCalledOnce();

			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("root:");
		} finally {
			resetForTesting();
			await ctx.cleanup();
		}
	});

	it("always resets autocomplete cache", async () => {
		const ctx = await setupClearCacheTool();
		try {
			await ctx.client.callTool({ name: "nanostores_clear_cache", arguments: {} });
			await ctx.client.callTool({ name: "nanostores_clear_cache", arguments: {} });

			expect(ctx.resetAutocompleteCache).toHaveBeenCalledTimes(2);
		} finally {
			await ctx.cleanup();
		}
	});
});
