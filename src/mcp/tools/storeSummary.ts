import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ProjectAnalysisService } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { URIS } from "../uris.js";
import { buildStoreSummaryText, buildStoreStructuredContent } from "../shared/storeSummary.js";

const StoreSummaryInputSchema = z.object({
	storeId: z.string().describe("Exact store id. If provided, takes priority.").optional(),
	name: z.string().describe("Store name. Used if storeId is not provided.").optional(),
	file: z.string().describe("Optional relative file path to disambiguate store name.").optional(),
});

const StoreSummaryOutputSchema = z.object({
	store: z.object({
		id: z.string(),
		file: z.string(),
		line: z.number(),
		kind: z.string(),
		name: z.string().optional(),
	}),
	resolution: z.object({
		by: z.enum(["id", "name", "id_tail"]),
		requested: z.string(),
		note: z.string().optional(),
	}),
	subscribers: z.array(
		z.object({
			id: z.string(),
			file: z.string(),
			line: z.number(),
			kind: z.string(),
			name: z.string().optional(),
			storeIds: z.array(z.string()),
		}),
	),
	derivesFrom: z.object({
		stores: z.array(
			z.object({
				id: z.string(),
				file: z.string(),
				line: z.number(),
				kind: z.string(),
				name: z.string().optional(),
			}),
		),
		relations: z.array(
			z.object({
				from: z.string(),
				to: z.string(),
				type: z.string(),
				file: z.string().optional(),
				line: z.number().optional(),
			}),
		),
	}),
	derivedDependents: z.object({
		stores: z.array(
			z.object({
				id: z.string(),
				file: z.string(),
				line: z.number(),
				kind: z.string(),
				name: z.string().optional(),
			}),
		),
		relations: z.array(
			z.object({
				from: z.string(),
				to: z.string(),
				type: z.string(),
				file: z.string().optional(),
				line: z.number().optional(),
			}),
		),
	}),
});

export function registerStoreSummaryTool(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerTool(
		"nanostores_store_summary",
		{
			title: "Summarize a Nanostores store",
			description:
				"Use this when you need details about a specific store — its kind, file location, " +
				"subscribers, and derived relations. Accepts store id or name. " +
				"Run nanostores_scan_project first if you don't know the store id.",
			inputSchema: StoreSummaryInputSchema,
			outputSchema: StoreSummaryOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ storeId, name, file }) => {
			if (!storeId && !name) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Either 'storeId' or 'name' must be provided to store_summary",
				);
			}

			const rootPath = resolveWorkspaceRoot();
			const key = storeId ? decodeURIComponent(storeId) : name!;

			try {
				const resolution = await projectService.resolveStoreByKey(rootPath, key, file);

				if (!resolution) {
					throw new McpError(
						ErrorCode.InvalidParams,
						`Store not found. Root: ${rootPath}, Requested: ${key}`,
					);
				}

				const { store, by: resolutionBy } = resolution;

				const { subscribers, derivesFrom, derivesFromEdges, dependents, dependentsEdges } =
					await projectService.getStoreNeighbors(rootPath, store);

				const structuredContent = buildStoreStructuredContent({
					store,
					requestedKey: key,
					resolutionBy,
					subscribers,
					derivesFromStores: derivesFrom,
					derivesFromEdges,
					dependentsStores: dependents,
					dependentsEdges,
				});

				const summaryText = buildStoreSummaryText({
					store,
					resolutionBy,
					resolutionRequested: key,
					subscribers,
					derivesFromStores: derivesFrom,
					dependentsStores: dependents,
				});
				const storeResourceUri = URIS.storeById(store.id);

				return {
					content: [
						{
							type: "text",
							text: summaryText,
						},
					],
					structuredContent,
					resourceLinks: [
						{
							uri: storeResourceUri,
						},
					],
				};
			} catch (error) {
				if (error instanceof McpError) throw error;
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				throw new McpError(
					ErrorCode.InternalError,
					`Failed to get store summary. Root: ${rootPath}, Error: ${msg}`,
				);
			}
		},
	);
}
