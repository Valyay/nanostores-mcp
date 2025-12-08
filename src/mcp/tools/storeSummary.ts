import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { URIS } from "../uris.js";
import { resolveStore, collectStoreNeighbors } from "../../domain/storeLookup.js";
import type { StoreMatch, SubscriberMatch, ProjectIndex } from "../../domain/fsScanner.js";

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

function buildStoreSummaryText(args: {
	store: StoreMatch;
	resolutionBy: string;
	resolutionRequested: string;
	resolutionNote?: string;
	subscribers: SubscriberMatch[];
	derivesFromStores: StoreMatch[];
	dependentsStores: StoreMatch[];
}): string {
	const {
		store,
		resolutionBy,
		resolutionRequested,
		resolutionNote,
		subscribers,
		derivesFromStores,
		dependentsStores,
	} = args;

	const lines: string[] = [];

	lines.push(`Store: ${store.name ?? store.id}`);
	lines.push(`Kind: ${store.kind}`);
	lines.push(`File: ${store.file}:${store.line}`);
	lines.push("");
	lines.push(`Resolved by: ${resolutionBy} (requested: ${resolutionRequested})`);
	if (resolutionNote) {
		lines.push(resolutionNote);
	}
	lines.push("");

	if (derivesFromStores.length > 0) {
		lines.push("Derives from:");
		for (const s of derivesFromStores) {
			lines.push(`- ${s.name ?? s.id} (${s.file}:${s.line})`);
		}
	} else {
		lines.push("Derives from: none (base store)");
	}

	if (dependentsStores.length > 0) {
		lines.push("");
		lines.push("Derived dependents:");
		for (const s of dependentsStores) {
			lines.push(`- ${s.name ?? s.id} (${s.file}:${s.line})`);
		}
	} else {
		lines.push("");
		lines.push("Derived dependents: none");
	}

	if (subscribers.length > 0) {
		lines.push("");
		lines.push("Subscribers (components/hooks/effects):");
		for (const sub of subscribers) {
			const displayName = sub.name || sub.id;
			lines.push(`- [${sub.kind}] ${displayName} (${sub.file}:${sub.line})`);
		}
	} else {
		lines.push("");
		lines.push("Subscribers: none found");
	}

	return lines.join("\n");
}

export function registerStoreSummaryTool(server: McpServer): void {
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
			let index: ProjectIndex;

			try {
				index = await scanProject(rootPath);
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					content: [
						{
							type: "text",
							text:
								"Failed to scan project for store summary.\n\n" +
								`Root: ${rootPath}\n` +
								`Error: ${msg}`,
						},
					],
				};
			}

			// Decode and resolve the key
			const key = storeId ? decodeURIComponent(storeId) : name!;
			const resolution = resolveStore(index, key, { file });

			if (!resolution) {
				return {
					content: [
						{
							type: "text",
							text:
								"Store not found.\n\n" +
								`Root: ${index.rootDir}\n` +
								`Requested: ${key}\n` +
								`Known stores: ${index.stores.length}`,
						},
					],
				};
			}

			const { store, by: resolutionBy, note: resolutionNote } = resolution;

			const {
				subscribers,
				derivesFromStores,
				derivesFromEdges,
				dependentsStores,
				dependentsEdges,
			} = collectStoreNeighbors(index, store);

			const structuredContent = {
				store: {
					id: store.id,
					file: store.file,
					line: store.line,
					kind: store.kind,
					name: store.name,
				},
				resolution: {
					by: resolutionBy,
					requested: key,
					note: resolutionNote,
				},
				subscribers: subscribers.map(sub => ({
					id: sub.id,
					file: sub.file,
					line: sub.line,
					kind: sub.kind,
					name: sub.name,
					storeIds: sub.storeIds,
				})),
				derivesFrom: {
					stores: derivesFromStores.map(s => ({
						id: s.id,
						file: s.file,
						line: s.line,
						kind: s.kind,
						name: s.name,
					})),
					relations: derivesFromEdges.map(r => ({
						from: r.from,
						to: r.to,
						type: r.type,
						file: r.file,
						line: r.line,
					})),
				},
				derivedDependents: {
					stores: dependentsStores.map(s => ({
						id: s.id,
						file: s.file,
						line: s.line,
						kind: s.kind,
						name: s.name,
					})),
					relations: dependentsEdges.map(r => ({
						from: r.from,
						to: r.to,
						type: r.type,
						file: r.file,
						line: r.line,
					})),
				},
			};

			const summaryText = buildStoreSummaryText({
				store,
				resolutionBy,
				resolutionRequested: key,
				resolutionNote,
				subscribers,
				derivesFromStores,
				dependentsStores,
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
		},
	);
}
