import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createProjectFixture } from "../../helpers/fixtures.ts";
import { resetForTesting, setClientRoots } from "../../../src/config/settings.ts";
import { setupStaticMcp, stabilizePaths, type TestMcpContext } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Shared fixture — created once (AST scanning is expensive)
// ---------------------------------------------------------------------------

let rootDir = "";

beforeAll(async () => {
	// Resolve symlinks so paths match what setClientRoots produces via realpathSafe
	// (macOS: /var/folders/... → /private/var/folders/...)
	rootDir = await fs.realpath(await createProjectFixture());
});

afterAll(async () => {
	resetForTesting();
	if (rootDir) {
		await fs.rm(rootDir, { recursive: true, force: true });
	}
});

/**
 * Per-test setup: fresh McpServer + Client pair with workspace roots configured.
 * Caller must call ctx.cleanup() in a finally block.
 */
async function setup(): Promise<TestMcpContext> {
	resetForTesting();
	setClientRoots([{ uri: pathToFileURL(rootDir).href }]);
	return setupStaticMcp();
}

// ===========================================================================
// Tools
// ===========================================================================

describe("Tools", () => {
	describe("nanostores_scan_project", () => {
		it("scans fixture and returns stores, subscribers, and relations", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_scan_project", {});
				const sc = result.structuredContent as {
					root: string;
					filesScanned: number;
					stores: Array<{ name?: string; kind: string }>;
					subscribers: Array<{ name?: string }>;
					relations: Array<{ type: string }>;
				};

				expect(sc.filesScanned).toBeGreaterThan(0);
				expect(sc.stores.length).toBeGreaterThan(0);
				expect(sc.subscribers.length).toBeGreaterThan(0);
				expect(sc.relations.length).toBeGreaterThan(0);

				const storeNames = sc.stores.map(s => s.name);
				expect(storeNames).toContain("$count");
				expect(storeNames).toContain("$cart");
				expect(storeNames).toContain("$total");

				const subNames = sc.subscribers.map(s => s.name);
				expect(subNames).toContain("Counter");

				const relationTypes = sc.relations.map(r => r.type);
				expect(relationTypes).toContain("derives_from");
				expect(relationTypes).toContain("subscribes_to");

				expect(stabilizePaths(result.text, rootDir)).toContain("<root>");
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns isError for out-of-roots path", async () => {
			const ctx = await setup();
			try {
				await expect(
					ctx.callTool("nanostores_scan_project", {
						rootUri: "/nonexistent/outside/workspace",
					}),
				).rejects.toThrow(/outside of allowed roots/i);
			} finally {
				await ctx.cleanup();
			}
		});

		it("accepts force parameter and returns fresh results", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_scan_project", { force: true });
				const sc = result.structuredContent as { filesScanned: number };
				expect(sc.filesScanned).toBeGreaterThan(0);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_clear_cache", () => {
		it("clears cache and allows fresh scan", async () => {
			const ctx = await setup();
			try {
				// First scan populates cache
				await ctx.callTool("nanostores_scan_project", {});

				// Clear cache
				const clearResult = await ctx.callTool("nanostores_clear_cache", {});
				expect(clearResult.text).toContain("Cache cleared");

				// Second scan should succeed (fresh scan)
				const result = await ctx.callTool("nanostores_scan_project", {});
				const sc = result.structuredContent as { filesScanned: number };
				expect(sc.filesScanned).toBeGreaterThan(0);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_store_summary", () => {
		it("resolves store by name and returns structured content", async () => {
			const ctx = await setup();
			try {
				// Use $cart — unique name in the fixture (unlike $count which exists in two files)
				const result = await ctx.callTool("nanostores_store_summary", { name: "$cart" });
				const sc = result.structuredContent as {
					store: { name?: string; kind: string };
					resolution: { by: string; requested: string };
					subscribers: Array<{ name?: string; kind: string }>;
					derivedDependents: { stores: Array<{ name?: string }> };
				};

				expect(sc.store.name).toBe("$cart");
				expect(sc.store.kind).toBe("map");
				expect(sc.resolution.requested).toBe("$cart");

				// cartEffect subscribes to $cart
				expect(sc.subscribers.length).toBeGreaterThan(0);
				const subNames = sc.subscribers.map(s => s.name);
				expect(subNames).toContain("cartEffect");

				// $bundle derives from $cart
				const depNames = sc.derivedDependents.stores.map(s => s.name);
				expect(depNames).toContain("$bundle");
			} finally {
				await ctx.cleanup();
			}
		});

		it("resolves store by storeId with resolution.by = id", async () => {
			const ctx = await setup();
			try {
				// First get a store id via scan
				const scan = await ctx.callTool("nanostores_scan_project", {});
				const scanSc = scan.structuredContent as {
					stores: Array<{ id: string; name?: string }>;
				};
				const cartStore = scanSc.stores.find(s => s.name === "$cart");
				expect(cartStore).toBeDefined();

				const result = await ctx.callTool("nanostores_store_summary", { storeId: cartStore!.id });
				const sc = result.structuredContent as {
					store: { name?: string };
					resolution: { by: string; requested: string };
				};

				expect(sc.store.name).toBe("$cart");
				expect(sc.resolution.by).toBe("id");
				expect(sc.resolution.requested).toBe(cartStore!.id);
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns non-empty relations for computed store", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_store_summary", { name: "$total" });
				const sc = result.structuredContent as {
					store: { name?: string; kind: string };
					derivesFrom: {
						stores: Array<{ name?: string }>;
						relations: Array<{ from: string; to: string; type: string }>;
					};
				};

				expect(sc.store.kind).toBe("computed");
				expect(sc.derivesFrom.stores.length).toBeGreaterThan(0);
				expect(sc.derivesFrom.relations.length).toBeGreaterThan(0);
				expect(sc.derivesFrom.relations[0].type).toBe("derives_from");
				expect(sc.derivesFrom.relations[0].from).toContain("$total");
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns non-empty dependents relations for base store", async () => {
			const ctx = await setup();
			try {
				// $cart is a unique base store; $bundle derives from it
				const result = await ctx.callTool("nanostores_store_summary", { name: "$cart" });
				const sc = result.structuredContent as {
					derivedDependents: {
						stores: Array<{ name?: string }>;
						relations: Array<{ from: string; to: string; type: string }>;
					};
				};

				const depNames = sc.derivedDependents.stores.map(s => s.name);
				expect(depNames).toContain("$bundle");
				expect(sc.derivedDependents.relations.length).toBeGreaterThan(0);
				expect(sc.derivedDependents.relations[0].type).toBe("derives_from");
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns isError for unknown store name", async () => {
			const ctx = await setup();
			try {
				await expect(
					ctx.callTool("nanostores_store_summary", { name: "$nonExistentStore" }),
				).rejects.toThrow(/store not found/i);
			} finally {
				await ctx.cleanup();
			}
		});

		it("throws when neither storeId nor name is provided", async () => {
			const ctx = await setup();
			try {
				await expect(ctx.callTool("nanostores_store_summary", {})).rejects.toThrow(/storeId|name/i);
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_project_outline", () => {
		it("returns kind distribution, top dirs, and hubs", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_project_outline", {});
				const sc = result.structuredContent as {
					rootDir: string;
					totals: { stores: number; filesWithStores: number };
					storeKinds: Record<string, number>;
					topDirs: Array<{ dir: string; stores: number }>;
					hubs: Array<{ name: string; score: number }>;
				};

				expect(sc.totals.stores).toBeGreaterThan(0);
				expect(sc.totals.filesWithStores).toBeGreaterThan(0);
				expect(Object.keys(sc.storeKinds).length).toBeGreaterThan(0);
				expect(sc.topDirs.length).toBeGreaterThan(0);

				expect(result.text).toContain("Store kinds:");
			} finally {
				await ctx.cleanup();
			}
		});
	});

	describe("nanostores_store_subgraph", () => {
		it("returns BFS-expanded subgraph for a store", async () => {
			const ctx = await setup();
			try {
				const result = await ctx.callTool("nanostores_store_subgraph", {
					name: "$cart",
					radius: 2,
				});
				const sc = result.structuredContent as {
					centerStoreId: string;
					radius: number;
					nodes: Array<{ id: string; type: string }>;
					edges: Array<{ from: string; to: string; type: string }>;
					summary: { nodes: number; edges: number };
				};

				expect(sc.centerStoreId).toContain("$cart");
				expect(sc.radius).toBe(2);
				expect(sc.nodes.length).toBeGreaterThan(0);
				expect(sc.edges.length).toBeGreaterThan(0);
				expect(sc.summary.nodes).toBe(sc.nodes.length);
			} finally {
				await ctx.cleanup();
			}
		});

		it("returns smaller subgraph with radius 0", async () => {
			const ctx = await setup();
			try {
				const r0 = await ctx.callTool("nanostores_store_subgraph", {
					name: "$cart",
					radius: 0,
				});
				const r2 = await ctx.callTool("nanostores_store_subgraph", {
					name: "$cart",
					radius: 2,
				});

				const sc0 = r0.structuredContent as { nodes: unknown[] };
				const sc2 = r2.structuredContent as { nodes: unknown[] };

				expect(sc0.nodes.length).toBeLessThanOrEqual(sc2.nodes.length);
			} finally {
				await ctx.cleanup();
			}
		});

		it("throws when neither storeId nor name is provided", async () => {
			const ctx = await setup();
			try {
				await expect(ctx.callTool("nanostores_store_subgraph", {})).rejects.toThrow(
					/storeId|name/i,
				);
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
	it("listResources includes graph resource", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.listResources();
			const uris = result.resources.map(r => r.uri);

			expect(uris).toContain("nanostores://graph");
		} finally {
			await ctx.cleanup();
		}
	});

	it("listResourceTemplates includes store template", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.listResourceTemplates();
			const uriTemplates = result.resourceTemplates.map(t => t.uriTemplate);

			expect(uriTemplates.some(u => u.includes("store"))).toBe(true);
		} finally {
			await ctx.cleanup();
		}
	});

	it("graph resource returns text summary and JSON", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.readResource("nanostores://graph");

			expect(result.contents.length).toBeGreaterThanOrEqual(2);

			const textContent = result.contents.find(c => c.mimeType === "text/plain");
			expect(textContent?.text).toBeDefined();
			expect(stabilizePaths(textContent!.text!, rootDir)).toContain("Stores:");

			const jsonContent = result.contents.find(c => c.mimeType === "application/json");
			expect(jsonContent?.text).toBeDefined();

			const graph = JSON.parse(jsonContent!.text!) as {
				nodes: Array<{ type: string }>;
				edges: Array<{ type: string }>;
			};
			expect(graph.nodes.some(n => n.type === "store")).toBe(true);
			expect(graph.edges.length).toBeGreaterThan(0);
		} finally {
			await ctx.cleanup();
		}
	});

	it("store resource by name returns store details", async () => {
		const ctx = await setup();
		try {
			const encodedKey = encodeURIComponent("$count");
			const result = await ctx.readResource(`nanostores://store/${encodedKey}`);

			expect(result.contents.length).toBeGreaterThanOrEqual(1);
			const textContent = result.contents.find(c => c.mimeType === "text/plain");
			expect(textContent?.text).toMatch(/\$count/);
		} finally {
			await ctx.cleanup();
		}
	});
});

// ===========================================================================
// Prompts
// ===========================================================================

describe("Prompts", () => {
	it("listPrompts includes explain-project and explain-store", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.listPrompts();
			const names = result.prompts.map(p => p.name);

			expect(names).toContain("explain-project");
			expect(names).toContain("explain-store");
		} finally {
			await ctx.cleanup();
		}
	});

	it("explain-project prompt returns user message referencing graph resource", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.getPrompt({
				name: "explain-project",
				arguments: { focus: "cart" },
			});

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].role).toBe("user");

			const content = result.messages[0].content as { type: string; text: string };
			expect(content.type).toBe("text");
			expect(content.text).toContain("nanostores://graph");
			expect(content.text).toContain("cart");
		} finally {
			await ctx.cleanup();
		}
	});

	it("explain-store prompt returns user message referencing store resource", async () => {
		const ctx = await setup();
		try {
			const result = await ctx.client.getPrompt({
				name: "explain-store",
				arguments: { store_name: "$count" },
			});

			expect(result.messages).toHaveLength(1);

			const content = result.messages[0].content as { type: string; text: string };
			expect(content.type).toBe("text");
			expect(content.text).toContain("$count");
			expect(content.text).toContain("nanostores://store/");
		} finally {
			await ctx.cleanup();
		}
	});
});
