import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStaticFeatures } from "../../../src/features/static/index.ts";
import { registerRuntimeFeatures } from "../../../src/features/runtime/index.ts";
import { registerDocsFeatures } from "../../../src/features/docs/index.ts";
import { toToon } from "../../../src/shared/toon.ts";
import type { ProjectAnalysisService, RuntimeAnalysisService } from "../../../src/domain/index.ts";
import type { LoggerBridgeServer } from "../../../src/logger/loggerBridge.ts";

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

function createMockBridge(): LoggerBridgeServer {
	return {
		start: async () => {},
		stop: async () => {},
		getInfo: () => ({ enabled: false }),
	};
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
		const bridge = createMockBridge();
		const suggestStoreNames = async (): Promise<string[]> => [];

		expect(() =>
			registerRuntimeFeatures(server, runtimeService, bridge, suggestStoreNames),
		).not.toThrow();
	});

	it("registers docs features without errors (with null service)", () => {
		const server = new McpServer({ name: "test-server", version: "0.0.0" });

		expect(() => registerDocsFeatures(server, null)).not.toThrow();
	});
});

describe("TOON encoding", () => {
	it("encodes simple data to a non-empty string", () => {
		const result = toToon({ stores: [{ name: "$count", kind: "atom" }] });

		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("encodes an empty array", () => {
		const result = toToon({ stores: [] });

		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("handles nested objects", () => {
		const data = {
			summary: { total: 5, active: 3 },
			stores: [{ name: "$a", stats: { changes: 10, errors: 0 } }],
		};
		const result = toToon(data);
		expect(typeof result).toBe("string");
	});
});
