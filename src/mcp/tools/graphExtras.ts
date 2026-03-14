import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ProjectAnalysisService } from "../../domain/index.js";
import { buildGraphOutline, buildStoreSubgraph } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { storeNotFoundMessage } from "../shared/consts.js";

// ── nanostores_project_outline ────────────────────────────────────────────────

const ProjectOutlineInputSchema = z.object({
	projectRoot: z.string().optional().describe("Project root path (uses default if omitted)"),
});

const ProjectOutlineOutputSchema = z.object({
	rootDir: z.string(),
	totals: z.object({
		stores: z.number(),
		filesWithStores: z.number(),
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
		"nanostores_project_outline",
		{
			title: "Get project outline",
			description:
				"Use this for a quick overview of Nanostores usage in the project — " +
				"store kind distribution, top directories, and hub stores ranked by connectivity. " +
				"Lighter than a full scan.",
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
				summary += `Stores: ${outline.totals.stores}, Files: ${outline.totals.filesWithStores}\n\n`;

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
						summary += `- ${hub.name} (${hub.kind ?? "unknown"}, score: ${hub.score})\n`;
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
								`Run nanostores_scan_project first if the project hasn't been indexed.\n` +
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
		"nanostores_store_subgraph",
		{
			title: "Get store subgraph",
			description:
				"Use this when you need the dependency neighborhood of a store — " +
				"files, derived relations, and subscribers within a configurable BFS radius. " +
				"Useful for impact analysis and understanding store connectivity.",
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

				let summary = `Subgraph for ${store.name ?? store.id} (radius=${subgraph.radius})\n`;
				summary += `Nodes: ${subgraph.summary?.nodes ?? subgraph.nodes.length}, `;
				summary += `Edges: ${subgraph.summary?.edges ?? subgraph.edges.length}`;
				if (subgraph.summary?.subscribers) {
					summary += `, Subscribers: ${subgraph.summary.subscribers}`;
				}
				if (subgraph.summary?.dependencies) {
					summary += `, Dependencies: ${subgraph.summary.dependencies}`;
				}

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
