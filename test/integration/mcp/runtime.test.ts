import { describe, expect, it } from "vitest";
import { setupRuntimeMcp, type RuntimeTestMcpContext } from "./helpers.ts";
import type { NanostoresLoggerEvent } from "../../../src/domain/index.ts";

// ---------------------------------------------------------------------------
// Seed data — deterministic events for all runtime tests
// ---------------------------------------------------------------------------

const NOW = 1700000000000;

function makeSeedEvents(): NanostoresLoggerEvent[] {
	return [
		{ kind: "mount", storeName: "$counter", timestamp: NOW - 5000 },
		{
			kind: "change",
			storeName: "$counter",
			timestamp: NOW - 4000,
			changed: "value",
			newValue: 1,
			oldValue: 0,
		},
		{
			kind: "change",
			storeName: "$counter",
			timestamp: NOW - 3000,
			changed: "value",
			newValue: 2,
			oldValue: 1,
		},
		{
			kind: "change",
			storeName: "$counter",
			timestamp: NOW - 2000,
			changed: "value",
			newValue: 3,
			oldValue: 2,
		},
		{ kind: "mount", storeName: "$user", timestamp: NOW - 4500 },
		{
			kind: "change",
			storeName: "$user",
			timestamp: NOW - 3500,
			changed: "name",
			newValue: "Alice",
		},
		{
			kind: "action-start",
			storeName: "$user",
			timestamp: NOW - 3000,
			actionId: "a1",
			actionName: "fetchUser",
		},
		{
			kind: "action-end",
			storeName: "$user",
			timestamp: NOW - 2500,
			actionId: "a1",
			actionName: "fetchUser",
		},
		{
			kind: "action-start",
			storeName: "$user",
			timestamp: NOW - 2000,
			actionId: "a2",
			actionName: "updateUser",
		},
		{
			kind: "action-error",
			storeName: "$user",
			timestamp: NOW - 1500,
			actionId: "a2",
			actionName: "updateUser",
			error: "Network error",
			errorMessage: "Network error",
		},
	];
}

/**
 * Per-test setup: fresh McpServer + Client pair with seeded events.
 * Caller must call ctx.cleanup() in a finally block.
 */
async function setup(): Promise<RuntimeTestMcpContext> {
	const ctx = await setupRuntimeMcp();
	for (const event of makeSeedEvents()) {
		ctx.eventStore.add(event);
	}
	return ctx;
}

// ===========================================================================
// Tools
// ===========================================================================

describe("Tools", () => {
	describe("nanostores_ping", () => {
		it("returns alive message and logger bridge status", async () => {
			const ctx = await setupRuntimeMcp();
			try {
				const result = await ctx.callTool("nanostores_ping", { message: "hello" });
				const sc = result.structuredContent as {
					message: string;
					loggerBridge?: { enabled: boolean };
				};

				expect(sc.message).toBe("hello");
				expect(sc.loggerBridge).toEqual({ enabled: false });
				expect(result.text).toContain("hello");
				expect(result.text).toContain("Logger Bridge: disabled");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_store_activity", () => {
		it("returns activity for a specific store", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_store_activity", {
					storeName: "$counter",
				});
				const sc = result.structuredContent as {
					storeName: string;
					stats: { mounts: number; changes: number };
					events: Array<{ kind: string }>;
					summary: string;
				};

				expect(sc.storeName).toBe("$counter");
				expect(sc.stats.mounts).toBe(1);
				expect(sc.stats.changes).toBe(3);
				expect(sc.events.length).toBeGreaterThan(0);
				expect(sc.summary).toContain("$counter");
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns overall stats when no storeName given", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_store_activity", {});
				const sc = result.structuredContent as {
					storeName: string | undefined;
					stats: { stores: Array<{ storeName: string }>; totalEvents: number };
					events: Array<{ kind: string }>;
				};

				expect(sc.storeName).toBeUndefined();
				expect(sc.stats.totalEvents).toBe(10);
				expect(sc.stats.stores.length).toBe(2);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_find_noisy_stores", () => {
		it("returns stores sorted by activity", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_find_noisy_stores", { limit: 5 });
				const sc = result.structuredContent as {
					stores: Array<{ storeName: string; changes: number; actionsStarted: number }>;
					summary: string;
				};

				expect(sc.stores.length).toBe(2);
				// $counter has 3 changes + 0 actions = 3 activity
				// $user has 1 change + 2 actions = 3 activity — tie is possible
				const names = sc.stores.map(s => s.storeName);
				expect(names).toContain("$counter");
				expect(names).toContain("$user");
				expect(sc.summary).toContain("most active");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_runtime_overview", () => {
		it("returns runtime health report", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_runtime_overview", {});
				const sc = result.structuredContent as {
					summary: string;
					stats: { stores: unknown[]; totalEvents: number };
					noisyStores: Array<{ storeName: string }>;
					errorProneStores: Array<{ storeName: string }>;
					unmountedStores: unknown[];
				};

				expect(sc.stats.totalEvents).toBe(10);
				expect(sc.stats.stores).toHaveLength(2);
				expect(sc.noisyStores.length).toBeGreaterThan(0);
				// $user has 1 action error — the tool calls getErrorProneStores(1), not the default of 3
				expect(sc.errorProneStores.some(s => s.storeName === "$user")).toBe(true);
				expect(sc.summary).toContain("Runtime Overview");
			} finally {
				await ctx.cleanup();
			}
		});
	});
});

// ===========================================================================
// Resources
// ===========================================================================

describe("Resources", () => {
	it("listResources includes runtime resource templates", async () => {
		const ctx = await setup();
		try {
			const templates = await ctx.client.listResourceTemplates();
			const uriTemplates = templates.resourceTemplates.map(t => t.uriTemplate);

			expect(uriTemplates.some(u => u.includes("runtime"))).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});

	it("runtime stats resource returns JSON with store metrics", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.readResource("nanostores://runtime/stats");

			expect(result.contents.length).toBeGreaterThanOrEqual(1);
			const jsonContent = result.contents.find(c => c.mimeType === "application/json");
			expect(jsonContent?.text).toBeDefined();

			const data = JSON.parse(jsonContent!.text!) as {
				summary: { totalStores: number; totalEvents: number };
				allStores: Array<{ storeName: string }>;
			};
			expect(data.summary.totalStores).toBe(2);
			expect(data.summary.totalEvents).toBe(10);
		} finally {
			await ctx.cleanup();
		}
	});

	it("runtime events resource returns all events", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.readResource("nanostores://runtime/events");

			const jsonContent = result.contents.find(c => c.mimeType === "application/json");
			expect(jsonContent?.text).toBeDefined();

			const data = JSON.parse(jsonContent!.text!) as {
				events: Array<{ storeName: string; kind: string }>;
				stats: { totalEvents: number };
			};
			expect(data.events).toHaveLength(10);
			expect(data.stats.totalEvents).toBe(10);
		} finally {
			await ctx.cleanup();
		}
	});

	it("runtime_overview compact mode returns TOON-encoded data", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.callTool("nanostores_runtime_overview", { compact: true });

			// TOON output should mention store names
			expect(result.text).toContain("$counter");
			expect(result.text).toContain("$user");
			// structuredContent must still be present (MCP SDK requirement)
			expect(result.structuredContent).toBeDefined();
		} finally {
			await ctx.cleanup();
		}
	});

	it("find_noisy_stores compact mode returns TOON-encoded data", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.callTool("nanostores_find_noisy_stores", { compact: true });

			// TOON output should contain store identifiers
			expect(result.text.length).toBeGreaterThan(0);
			// structuredContent must still be present (MCP SDK requirement)
			expect(result.structuredContent).toBeDefined();
		} finally {
			await ctx.cleanup();
		}
	});
});

// ===========================================================================
// Prompts
// ===========================================================================

describe("Prompts", () => {
	it("listPrompts includes debug-store and debug-project-activity", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.listPrompts();
			const names = result.prompts.map(p => p.name);

			expect(names).toContain("debug-store");
			expect(names).toContain("debug-project-activity");
		} finally {
			await ctx.cleanup();
		}
	});

	it("debug-store prompt returns user message referencing runtime store resource", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.getPrompt({
				name: "debug-store",
				arguments: { store_name: "$counter" },
			});

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].role).toBe("user");

			const content = result.messages[0].content as { type: string; text: string };
			expect(content.type).toBe("text");
			expect(content.text).toContain("$counter");
			expect(content.text).toContain("nanostores://runtime/store/");
		} finally {
			await ctx.cleanup();
		}
	});

	it("debug-project-activity prompt returns user message referencing runtime resources", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.getPrompt({
				name: "debug-project-activity",
				arguments: {},
			});

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].role).toBe("user");

			const content = result.messages[0].content as { type: string; text: string };
			expect(content.type).toBe("text");
			expect(content.text).toContain("nanostores://runtime/stats");
			expect(content.text).toContain("nanostores://runtime/events");
		} finally {
			await ctx.cleanup();
		}
	});
});
