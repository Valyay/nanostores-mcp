import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectAnalysisService } from "../../domain/index.js";
import {
	buildGraphOutline,
	buildIdDictionary,
	buildStoreSubgraph,
} from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { URIS } from "../uris.js";

export function registerGraphOutlineResource(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerResource(
		"graph-outline",
		URIS.graphOutline,
		{
			title: "Nanostores graph outline",
			description:
				"High-level summary of Nanostores usage: store counts, kinds distribution, top directories, and hubs.",
		},
		async uri => {
			try {
				const rootPath = resolveWorkspaceRoot();
				const index = await projectService.getIndex(rootPath);
				const outline = buildGraphOutline(index);

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(outline),
						},
					],
					structuredContent: outline,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to build graph outline.\n\n" + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}

export function registerIdDictionaryResource(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerResource(
		"id-dictionary",
		URIS.idDictionary,
		{
			title: "Nanostores id dictionary",
			description:
				"Stable short ids for store and file identifiers to reduce repeated long strings in other resources.",
		},
		async uri => {
			try {
				const rootPath = resolveWorkspaceRoot();
				const index = await projectService.getIndex(rootPath);
				const dictionary = buildIdDictionary(index);

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(dictionary),
						},
					],
					structuredContent: dictionary,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to build id dictionary.\n\n" + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}

export function registerStoreSubgraphResource(
	server: McpServer,
	projectService: ProjectAnalysisService,
): void {
	server.registerResource(
		"store-subgraph",
		new ResourceTemplate(URIS.storeSubgraphBase, { list: undefined }),
		{
			title: "Nanostores store subgraph",
			description:
				"Task-scoped graph slice around a store: files, neighbors, and derived relations. Use query params store=<id|name> and radius=<number>.",
		},
		async uri => {
			const url = new URL(uri.href);
			const storeParam = url.searchParams.get("store");
			const radiusParam = url.searchParams.get("radius");

			if (!storeParam) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Missing required query parameter: store",
						},
					],
				};
			}

			const radius = radiusParam ? Number.parseInt(radiusParam, 10) : 2;

			try {
				const rootPath = resolveWorkspaceRoot();
				const index = await projectService.getIndex(rootPath);
				const store = await projectService.getStoreByKey(rootPath, storeParam);

				if (!store) {
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: "text/plain",
								text:
									"Store not found.\n\n" +
									`Requested key: ${storeParam}\n` +
									`Root: ${rootPath}`,
							},
						],
					};
				}

				const subgraph = buildStoreSubgraph(index, store, radius);

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify(subgraph),
						},
					],
					structuredContent: subgraph,
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to build store subgraph.\n\n" + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}
