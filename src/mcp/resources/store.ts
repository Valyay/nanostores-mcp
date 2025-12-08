import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectAnalysisService } from "../../domain/projectAnalysisService.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { URIS } from "../uris.js";
import { buildStoreSummaryText, buildStoreStructuredContent } from "../shared/storeSummary.js";

/**
 * Resource for a single store:
 *
 *   nanostores://store/{key}
 *
 * Where key can be:
 *   1) full store id:
 *      "store:src/stores/cart.ts#$cartTotal"
 *   2) store name:
 *      "$cartTotal" or "cartTotal"
 *
 * This is convenient:
 *   - for graph links: use id;
 *   - for user / prompts: use name.
 */
export function registerStoreResource(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerResource(
		"store",
		new ResourceTemplate(URIS.storeTemplate, {
			list: undefined,
		}),
		{
			title: "Nanostores store details",
			description:
				"Details for a single Nanostores store: kind, file, subscribers and derived relations. Can be addressed by id or by store name.",
		},
		async (uri, { key }) => {
			const rootPath = resolveWorkspaceRoot();
			const keyValue = Array.isArray(key) ? key[0] : key;
			const rawKey = decodeURIComponent(keyValue);

			try {
				// Use project service to find the store
				const store = await projectService.getStoreByKey(rootPath, rawKey);

				if (!store) {
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: "text/plain",
								text: `Store not found.\n\n` + `Requested key: ${rawKey}\n` + `Root: ${rootPath}`,
							},
						],
					};
				}

				// Get neighbors using service
				const { subscribers, derivesFrom, dependents } = await projectService.getStoreNeighbors(
					rootPath,
					store,
				);

				const summaryText = buildStoreSummaryText({
					store,
					subscribers,
					derivesFromStores: derivesFrom,
					dependentsStores: dependents,
				});

				const structuredContent = buildStoreStructuredContent({
					store,
					requestedKey: rawKey,
					subscribers,
					derivesFromStores: derivesFrom,
					dependentsStores: dependents,
				});
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: summaryText,
						},
						{
							uri: `${uri.href}#json`,
							mimeType: "application/json",
							text: JSON.stringify(structuredContent, null, 2),
						},
					],
					structuredContent,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to get store resource.\n\n" + `Root: ${rootPath}\n` + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}
