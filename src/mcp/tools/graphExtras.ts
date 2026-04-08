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

const StoreFlagsSchema = z.object({
	computedHasSideEffects: z.boolean().optional(),
	computedHasCleanupCalls: z.boolean().optional(),
	isInsideFactory: z.boolean().optional(),
	hasMountDependentActivation: z.boolean().optional(),
	writtenWithoutSubscribers: z.boolean().optional(),
	readViaGetOnly: z.boolean().optional(),
	storyOrTestOnlyWriter: z.boolean().optional(),
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
			mutators: z.number(),
			subscribersByKind: z.record(z.string(), z.number()),
			mutatorsByKind: z.record(z.string(), z.number()),
			flags: StoreFlagsSchema.optional(),
		}),
	),
	unreferencedStores: z.array(
		z.object({
			storeId: z.string(),
			name: z.string(),
			kind: z.string().optional(),
			file: z.string().optional(),
			valueType: z.string().optional(),
			mutatorCount: z.number(),
			sfcFileReferences: z.number(),
			isPersistent: z.boolean(),
			mutatorsByKind: z.record(z.string(), z.number()),
		}),
	),
	coOccurringPairs: z.array(
		z.object({
			storeIdA: z.string(),
			nameA: z.string(),
			storeIdB: z.string(),
			nameB: z.string(),
			count: z.number(),
		}),
	),
	topSemanticAnomalies: z.array(
		z.object({
			storeId: z.string(),
			name: z.string(),
			kind: z.string().optional(),
			file: z.string().optional(),
			score: z.number(),
			directSubscribers: z.number(),
			mutators: z.number(),
			flags: StoreFlagsSchema,
		}),
	),
	topBlindSpots: z.array(
		z.object({
			storeId: z.string(),
			name: z.string(),
			kind: z.string().optional(),
			file: z.string().optional(),
			blindSpotType: z.enum([
				"possibly_svelte_reactive",
				"factory_local",
				"story_or_test_scoped",
				"imperative_only",
				"truly_unreferenced_candidate",
			]),
			mutatorCount: z.number(),
			sfcFileReferences: z.number(),
			flags: StoreFlagsSchema.optional(),
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

				if (outline.topSemanticAnomalies.length > 0) {
					summary += `\nSemantic anomalies (stores with unusual flags — validate with source before concluding):\n`;
					for (const store of outline.topSemanticAnomalies) {
						const flagNames = Object.entries(store.flags)
							.filter(([, v]) => v === true)
							.map(([k]) => k)
							.join(", ");
						summary += `- ${store.name} (${store.kind ?? "unknown"}, score: ${store.score}) — flags: ${flagNames} — ${store.file}\n`;
					}
				}

				if (outline.topBlindSpots.length > 0) {
					summary += `\nBlind spots (stores appearing unreferenced — categorized by most likely reason):\n`;
					for (const store of outline.topBlindSpots) {
						const signals: string[] = [`type: ${store.blindSpotType}`];
						if (store.mutatorCount > 0) signals.push(`${store.mutatorCount} mutator(s)`);
						if (store.sfcFileReferences > 0) signals.push(`${store.sfcFileReferences} SFC ref(s)`);
						summary += `- ${store.name} (${store.kind ?? "unknown"}) [${signals.join(", ")}] — ${store.file}\n`;
					}
				}

				if (outline.unreferencedStores.length > 0) {
					summary += `\nUnreferenced stores (${outline.unreferencedStores.length} detected by static analysis):\n`;
					for (const store of outline.unreferencedStores) {
						const signals: string[] = [];
						if (store.mutatorCount > 0) signals.push(`${store.mutatorCount} mutator(s)`);
						if (store.sfcFileReferences > 0) signals.push(`${store.sfcFileReferences} SFC file ref(s)`);
						if (store.isPersistent) signals.push("persistent");
						if (store.valueType) signals.push(`type: ${store.valueType}`);
						const signalStr = signals.length > 0 ? ` [${signals.join(", ")}]` : "";
						summary += `- ${store.name} (${store.kind ?? "unknown"}) at ${store.file}${signalStr}\n`;
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
			valueType: z.string().optional(),
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
				`If your question is 'what recomputes downstream when X changes?', use ${TOOLS.storeImpact} instead — it gives the ordered causal chain in one call. ` +
				"Use this tool only when you need both directions: upstream sources AND downstream dependents together. " +
				"Returns the BFS neighborhood within a configurable radius (default 2). " +
				"Start with radius=1; increase only when you need wider structural context. " +
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
	valueType: z.string().optional(),
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
				"When you need to trace what recomputes if X changes, call this once — not nanostores_store_summary on each downstream store. " +
				"Returns the full ordered downstream chain in a single response: " +
				"computed stores that depend on X at hop 1, their dependents at hop 2, and so on. " +
				"Subscribers appear at the same hop as the store they react to. " +
				"Use nanostores_store_subgraph instead when you also need upstream ancestors (BFS in both directions). " +
				'Example: {name: "$isLoggedIn"} returns every computed store and subscriber that recomputes when $isLoggedIn changes, ordered by distance.',
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
							const typeStr = s.valueType ? `: ${s.valueType}` : "";
							text += `  [derived]     ${s.name ?? s.id}${typeStr} (${s.kind}) — ${s.file}\n`;
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
