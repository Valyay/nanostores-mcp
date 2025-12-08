import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProjectAnalysisService } from "../../domain/projectAnalysisService.js";
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
		"store_summary",
		{
			title: "Summarize a Nanostores store",
			description:
				"Finds a Nanostores store by id or name and returns its details: kind, file, subscribers and derived relations.",
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
				throw new Error("Either 'storeId' or 'name' must be provided to store_summary");
			}

			const rootPath = resolveWorkspaceRoot();
			const key = storeId ? decodeURIComponent(storeId) : name!;

			try {
				// Use project service to find the store
				const store = await projectService.getStoreByKey(rootPath, key, file);

				if (!store) {
					return {
						content: [
							{
								type: "text",
								text: "Store not found.\n\n" + `Root: ${rootPath}\n` + `Requested: ${key}`,
							},
						],
					};
				}

				// Get neighbors using service
				const { subscribers, derivesFrom, dependents } = await projectService.getStoreNeighbors(
					rootPath,
					store,
				);

				const structuredContent = buildStoreStructuredContent({
					store,
					requestedKey: key,
					resolutionBy: "name",
					subscribers,
					derivesFromStores: derivesFrom,
					dependentsStores: dependents,
				});

				const summaryText = buildStoreSummaryText({
					store,
					resolutionBy: "name",
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
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					content: [
						{
							type: "text",
							text: "Failed to get store summary.\n\n" + `Root: ${rootPath}\n` + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}
