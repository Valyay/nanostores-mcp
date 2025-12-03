import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

type ScanResult = Awaited<ReturnType<typeof scanProject>>;
type StoreMatch = ScanResult["stores"][number];
type SubscriberMatch = ScanResult["subscribers"][number];
type StoreRelation = ScanResult["relations"][number];

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

function resolveStoreById(result: ScanResult, id: string): StoreMatch | undefined {
	return result.stores.find(s => s.id === id);
}

function resolveStoreByName(
	result: ScanResult,
	rawName: string,
	file?: string,
): { store?: StoreMatch; note?: string } {
	// поддерживаем "$counter" и "counter"
	const nameCandidates = new Set<string>();

	if (rawName.startsWith("$")) {
		nameCandidates.add(rawName); // "$counter"
		nameCandidates.add(rawName.slice(1)); // "counter"
	} else {
		nameCandidates.add(rawName); // "counter"
		nameCandidates.add(`$${rawName}`); // "$counter"
	}

	let matches = result.stores.filter(s => s.name && nameCandidates.has(s.name));

	// если указали file — фильтруем по нему
	if (file) {
		matches = matches.filter(s => s.file === file);
	}

	if (matches.length === 0) {
		// fallback: пробуем по хвосту id (#name / #$name)
		const tailMatches = result.stores.filter(s => {
			const tail = s.id.split("#").slice(-1)[0];
			return nameCandidates.has(tail);
		});

		if (tailMatches.length === 1) {
			return {
				store: tailMatches[0],
				note: `Resolved by id tail: ${rawName}`,
			};
		}
		if (tailMatches.length > 1) {
			tailMatches.sort((a, b) => a.file.localeCompare(b.file));
			const others = tailMatches
				.slice(1)
				.map(s => s.file)
				.join(", ");
			return {
				store: tailMatches[0],
				note: `Resolved by id tail: ${rawName} (multiple matches, using first from ${tailMatches[0].file}). Other matches in: ${others}`,
			};
		}

		return { store: undefined, note: undefined };
	}

	if (matches.length === 1) {
		return {
			store: matches[0],
			note: `Resolved by name: ${rawName}`,
		};
	}

	// несколько матчей — берём первый по сортировке
	matches.sort((a, b) => a.file.localeCompare(b.file));
	const others = matches
		.slice(1)
		.map(s => s.file)
		.join(", ");
	return {
		store: matches[0],
		note: `Resolved by name: ${rawName} (multiple matches, using first from ${matches[0].file}). Other matches in: ${others}`,
	};
}

function collectNeighbors(
	result: ScanResult,
	store: StoreMatch,
): {
	subscribers: SubscriberMatch[];
	derivesFromStores: StoreMatch[];
	derivesFromEdges: StoreRelation[];
	dependentsStores: StoreMatch[];
	dependentsEdges: StoreRelation[];
} {
	const allRelations: StoreRelation[] = result.relations;

	const subscribers: SubscriberMatch[] = result.subscribers.filter(sub =>
		sub.storeIds.includes(store.id),
	);

	const derivesFromEdges = allRelations.filter(
		r => r.type === "derives_from" && r.from === store.id,
	);
	const derivesFromIds = new Set(derivesFromEdges.map(r => r.to));
	const derivesFromStores: StoreMatch[] = result.stores.filter(s => derivesFromIds.has(s.id));

	const dependentsEdges = allRelations.filter(r => r.type === "derives_from" && r.to === store.id);
	const dependentsIds = new Set(dependentsEdges.map(r => r.from));
	const dependentsStores: StoreMatch[] = result.stores.filter(s => dependentsIds.has(s.id));

	return {
		subscribers,
		derivesFromStores,
		derivesFromEdges,
		dependentsStores,
		dependentsEdges,
	};
}

function buildStoreSummaryText(args: {
	store: StoreMatch;
	resolutionBy: "id" | "name" | "id_tail";
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
			let result: ScanResult;

			try {
				result = await scanProject(rootPath);
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

			let store: StoreMatch | undefined;
			let resolutionBy: "id" | "name" | "id_tail";
			let resolutionNote: string | undefined;
			let requestedKey: string;

			if (storeId) {
				const decoded = decodeURIComponent(storeId);
				requestedKey = decoded;
				store = resolveStoreById(result, decoded);
				resolutionBy = "id";
				resolutionNote = `Resolved by id: ${decoded}`;
				if (!store) {
					// попробуем ещё по хвосту (последняя часть после '#')
					const tail = decoded.split("#").slice(-1)[0];
					const byTail = resolveStoreByName(result, tail);
					if (byTail.store) {
						store = byTail.store;
						resolutionBy = "id_tail";
						resolutionNote = byTail.note ?? `Resolved by id tail: ${tail}`;
					}
				}
			} else {
				// name обязателен здесь
				const rawName = name!;
				requestedKey = rawName;
				const { store: byName, note } = resolveStoreByName(result, rawName, file);
				store = byName;
				resolutionBy = "name";
				resolutionNote = note;
			}

			if (!store) {
				return {
					content: [
						{
							type: "text",
							text:
								"Store not found.\n\n" +
								`Root: ${result.rootDir}\n` +
								`Requested: ${storeId ?? name}\n` +
								`Known stores: ${result.stores.length}`,
						},
					],
				};
			}

			const {
				subscribers,
				derivesFromStores,
				derivesFromEdges,
				dependentsStores,
				dependentsEdges,
			} = collectNeighbors(result, store);

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
					requested: requestedKey,
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
				resolutionRequested: requestedKey,
				resolutionNote,
				subscribers,
				derivesFromStores,
				dependentsStores,
			});

			const storeResourceUri = `nanostores://store/${encodeURIComponent(store.id)}`;

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
