import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStaticFeatures } from "../../../src/features/static/index.ts";
import { registerRuntimeFeatures } from "../../../src/features/runtime/index.ts";
import { registerDocsFeatures } from "../../../src/features/docs/index.ts";
import type { ProjectAnalysisService, RuntimeAnalysisService } from "../../../src/domain/index.ts";

function createMockProjectService(): ProjectAnalysisService {
	return {
		scanProject: async () => ({
			rootDir: "/tmp",
			filesScanned: 0,
			stores: [],
			subscribers: [],
			relations: [],
		}),
		getIndex: async () => ({
			rootDir: "/tmp",
			filesScanned: 0,
			stores: [],
			subscribers: [],
			relations: [],
		}),
		resolveStore: async () => undefined,
	} as unknown as ProjectAnalysisService;
}

function createMockRuntimeService(): RuntimeAnalysisService {
	return {
		getEvents: () => [],
		getStats: () => ({
			stores: [],
			totalEvents: 0,
			sessionStartedAt: Date.now(),
			lastEventAt: Date.now(),
		}),
		getNoisyStores: () => [],
		getErrorProneStores: () => [],
		getStoreProfile: async () => undefined,
	} as unknown as RuntimeAnalysisService;
}

describe("MCP feature registration", () => {
	it("registers static features without errors", () => {
		const server = new McpServer({ name: "test-server", version: "0.0.0" });
		const projectService = createMockProjectService();
		const suggestStoreNames = async (): Promise<string[]> => [];
		const resetCache = (): void => {};

		expect(() =>
			registerStaticFeatures(server, projectService, suggestStoreNames, resetCache),
		).not.toThrow();
	});

	it("registers runtime features without errors", () => {
		const server = new McpServer({ name: "test-server", version: "0.0.0" });
		const runtimeService = createMockRuntimeService();
		const suggestStoreNames = async (): Promise<string[]> => [];

		expect(() => registerRuntimeFeatures(server, runtimeService, suggestStoreNames)).not.toThrow();
	});

	it("registers docs features without errors (with null service)", () => {
		const server = new McpServer({ name: "test-server", version: "0.0.0" });

		expect(() => registerDocsFeatures(server, null)).not.toThrow();
	});
});
