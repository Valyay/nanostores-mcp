import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ProjectAnalysisService } from "../../domain/index.js";
import { buildGraphOutline, buildStoreSubgraph, buildStoreImpact } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { storeNotFoundMessage } from "../shared/consts.js";
import { formatSubgraphText } from "../shared/subgraphText.js";
import { TOOLS } from "../uris.js";

// ── nanostores_project_outline ────────────────────────────────────────────────

const ProjectOutlineInputSchema = z.object({
	projectRoot: z.string().optional().describe("Project root path (uses default if omitted)"),
});

const ProjectOutlineOutputSchema = z.object({
	rootDir: z.string(),
	totals: z.object({
		stores: z.number(),
		filesWithStores: z.number(),
		subscribers: z.number(),
	}),
	storeKinds: z.record(z.string(), z.number()),
	topDirs: z.array(
		z.object({
			dir: z.string(),
			stores: z.number(),
			files: z.number(),
		}),
	),
	hubs: z.array(
		z.object({
			storeId: z.string(),
			name: z.string(),
			kind: z.string().optional(),
			file: z.string().optional(),
			score: z.number(),
			subscribers: z.number(),
			derivedDependents: z.number(),
		}),
	),
	deadStores: z.array(
		z.object({
			storeId: z.string(),
			name: z.string(),
			kind: z.string().optional(),
			file: z.string().optional(),
			category: z.enum(["dev-only", "write-only", "framework-template", "orphaned", "unclassified"]),
			reason: z.string(),
		}),
	),
});

/**
 * Tool: nanostores_project_outline
 * High-level summary of Nanostores usage in the project
 */
export function registerProjectOutlineTool(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerTool(
		TOOLS.projectOutline,
		{
			title: "Get project outline",
			description:
				"Use this for a quick overview of Nanostores usage in the project — " +
				"store kind distribution, top directories, and hub stores ranked by connectivity. " +
				"Returns a compact summary instead of full store/subscriber lists (same scan data, smaller response). " +
				`Use ${TOOLS.scanProject} when you need the complete list of stores and relations.`,
			inputSchema: ProjectOutlineInputSchema,
			outputSchema: ProjectOutlineOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ projectRoot }) => {
			try {
				const rootPath = resolveWorkspaceRoot(projectRoot);
				const index = await projectService.getIndex(rootPath);
				const outline = buildGraphOutline(index);

				let summary = `Project: ${outline.rootDir}\n`;
				summary += `Stores: ${outline.totals.stores}, Files: ${outline.totals.filesWithStores}, Subscribers: ${outline.totals.subscribers}\n\n`;

				summary += `Store kinds:\n`;
				for (const [kind, count] of Object.entries(outline.storeKinds)) {
					summary += `- ${kind}: ${count}\n`;
				}

				if (outline.topDirs.length > 0) {
					summary += `\nTop directories:\n`;
					for (const dir of outline.topDirs) {
						summary += `- ${dir.dir}: ${dir.stores} stores in ${dir.files} files\n`;
					}
				}

				if (outline.hubs.length > 0) {
					summary += `\nHub stores (by connectivity):\n`;
					for (const hub of outline.hubs) {
						summary += `- ${hub.name} (${hub.kind ?? "unknown"}, score: ${hub.score}, subs: ${hub.subscribers}, derived: ${hub.derivedDependents})\n`;
					}
				}

				if (outline.deadStores.length > 0) {
					summary += `\nDead stores (${outline.deadStores.length} total):\n`;
					const byCategory = new Map<string, typeof outline.deadStores>();
					for (const dead of outline.deadStores) {
						const list = byCategory.get(dead.category) ?? [];
						list.push(dead);
						byCategory.set(dead.category, list);
					}
					for (const [category, stores] of byCategory) {
						summary += `\n  [${category}] (${stores.length}):\n`;
						for (const dead of stores) {
							summary += `  - ${dead.name} (${dead.kind ?? "unknown"}) at ${dead.file}\n`;
						}
					}
				}

				return {
					content: [{ type: "text", text: summary }],
					structuredContent: outline,
				};
			} catch (error) {
				if (error instanceof McpError) throw error;
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								`Failed to build project outline.\n\n` +
								`Run ${TOOLS.scanProject} first if the project hasn't been indexed.\n` +
								`Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}

// ── nanostores_store_subgraph ─────────────────────────────────────────────────

const StoreSubgraphInputSchema = z.object({
	storeId: z.string().describe("Exact store id. If provided, takes priority.").optional(),
	name: z.string().describe("Store name. Used if storeId is not provided.").optional(),
	radius: z
		.number()
		.int()
		.min(0)
		.max(10)
		.optional()
		.default(2)
		.describe("BFS radius around the store (default 2)"),
	projectRoot: z.string().optional().describe("Project root path (uses default if omitted)"),
});

const StoreSubgraphOutputSchema = z.object({
	centerStoreId: z.string(),
	radius: z.number(),
	nodes: z.array(
		z.object({
			id: z.string(),
			type: z.enum(["store", "file"]),
			name: z.string().optional(),
			kind: z.string().optional(),
			file: z.string().optional(),
			path: z.string().optional(),
		}),
	),
	edges: z.array(
		z.object({
			from: z.string(),
			to: z.string(),
			type: z.string(),
		}),
	),
	summary: z
		.object({
			nodes: z.number(),
			edges: z.number(),
			subscribers: z.number().optional(),
			dependencies: z.number().optional(),
		})
		.optional(),
	warning: z.string().optional(),
});

/**
 * Tool: nanostores_store_subgraph
 * Get a BFS-expanded subgraph around a specific store
 */
export function registerStoreSubgraphTool(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerTool(
		TOOLS.storeSubgraph,
		{
			title: "Get store subgraph",
			description:
				"Use this when you need the bidirectional neighborhood of a store — " +
				"files, derived relations, and subscribers within a configurable BFS radius (default 2). " +
				`Unlike ${TOOLS.storeSummary} (direct neighbors only), this follows transitive chains ` +
				"in both directions (upstream dependencies and downstream dependents). " +
				`Use ${TOOLS.storeImpact} instead when the question is 'what recomputes if X changes?' — ` +
				"that tool follows the causal direction only and gives ordered hops. " +
				"Start with radius=1; increase only when you need the wider structural context. " +
				"On highly connected hub stores (score>5 in project_outline) radius=2+ may return most of the project. " +
				'Example: {name: "$cart", radius: 1} or {storeId: "store:src/stores.ts#$cart", radius: 2}.',
			inputSchema: StoreSubgraphInputSchema,
			outputSchema: StoreSubgraphOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ storeId, name, radius, projectRoot }) => {
			if (!storeId && !name) {
				throw new McpError(ErrorCode.InvalidParams, "Either 'storeId' or 'name' must be provided");
			}

			const rootPath = resolveWorkspaceRoot(projectRoot);
			const key = storeId ? decodeURIComponent(storeId) : name!;

			try {
				const index = await projectService.getIndex(rootPath);
				const store = await projectService.getStoreByKey(rootPath, key);

				if (!store) {
					throw new McpError(ErrorCode.InvalidParams, storeNotFoundMessage(key, rootPath));
				}

				const subgraph = buildStoreSubgraph(index, store, radius);

				const summary = formatSubgraphText(subgraph, store.name ?? store.id);

				return {
					content: [{ type: "text", text: summary }],
					structuredContent: subgraph,
				};
			} catch (error) {
				if (error instanceof McpError) throw error;
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to build store subgraph. Root: ${rootPath}\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}

// ── nanostores_store_impact ───────────────────────────────────────────────────

const StoreImpactInputSchema = z.object({
	storeId: z.string().optional().describe("Exact store id. If provided, takes priority."),
	name: z.string().optional().describe("Store name. Used if storeId is not provided."),
	projectRoot: z.string().optional().describe("Project root path (uses default if omitted)"),
});

const ImpactedStoreSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	kind: z.string(),
	file: z.string(),
});

const ImpactedSubscriberSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	kind: z.string(),
	file: z.string(),
});

const StoreImpactOutputSchema = z.object({
	sourceStoreId: z.string(),
	sourceName: z.string().optional(),
	hops: z.array(
		z.object({
			hop: z.number(),
			derivedStores: z.array(ImpactedStoreSchema),
			subscribers: z.array(ImpactedSubscriberSchema),
		}),
	),
	summary: z.object({
		totalAffectedStores: z.number(),
		totalAffectedSubscribers: z.number(),
		maxHops: z.number(),
	}),
});

/**
 * Tool: nanostores_store_impact
 * One-directional causal impact traversal: what recomputes/re-renders if X changes?
 */
export function registerStoreImpactTool(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerTool(
		TOOLS.storeImpact,
		{
			title: "Get store impact chain",
			description:
				"Use this to answer 'what will recompute or re-render if X changes?' — the primary refactoring question. " +
				"Unlike nanostores_store_subgraph (BFS in both directions), this tool follows the causal direction only: " +
				"derived stores that declared X as a dependency, then their derived stores, and so on. " +
				"Subscribers appear at the same hop as the store they react to. " +
				"Returns hops ordered from closest to farthest impact. " +
				'Example: {name: "$isLoggedIn"} shows everything that recomputes when $isLoggedIn changes.',
			inputSchema: StoreImpactInputSchema,
			outputSchema: StoreImpactOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ storeId, name, projectRoot }) => {
			if (!storeId && !name) {
				throw new McpError(ErrorCode.InvalidParams, "Either 'storeId' or 'name' must be provided");
			}

			const rootPath = resolveWorkspaceRoot(projectRoot);
			const key = storeId ? decodeURIComponent(storeId) : name!;

			try {
				const index = await projectService.getIndex(rootPath);
				const store = await projectService.getStoreByKey(rootPath, key);

				if (!store) {
					throw new McpError(ErrorCode.InvalidParams, storeNotFoundMessage(key, rootPath));
				}

				const impact = buildStoreImpact(index, store);

				let text = `Impact of ${impact.sourceName ?? impact.sourceStoreId}:\n`;
				if (impact.hops.length === 0) {
					text += "No downstream impact found — no derived stores or subscribers.";
				} else {
					for (const hop of impact.hops) {
						text += `\nHop ${hop.hop}:\n`;
						for (const s of hop.derivedStores) {
							text += `  [derived]     ${s.name ?? s.id} (${s.kind}) — ${s.file}\n`;
						}
						for (const s of hop.subscribers) {
							text += `  [subscriber]  ${s.name ?? s.id} (${s.kind}) — ${s.file}\n`;
						}
					}
					text += `\nTotal: ${impact.summary.totalAffectedStores} derived stores, `;
					text += `${impact.summary.totalAffectedSubscribers} subscribers, `;
					text += `${impact.summary.maxHops} hop(s).`;
				}

				return {
					content: [{ type: "text", text }],
					structuredContent: impact,
				};
			} catch (error) {
				if (error instanceof McpError) throw error;
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Failed to compute store impact. Root: ${rootPath}\nError: ${msg}`,
						},
					],
				};
			}
		},
	);
}
