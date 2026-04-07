import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProjectAnalysisService } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { createMcpProgressCallback } from "../shared/progress.js";
import { TOOLS, URIS } from "../uris.js";

const ScanProjectInputSchema = z.object({
	// file:// URI or path inside workspace; if not specified - first root is taken
	rootUri: z.string().optional(),
	force: z.boolean().optional().describe("Force a fresh scan, bypassing the cache."),
	compact: z
		.boolean()
		.optional()
		.describe(
			"Return a compact directory-level summary instead of full store/subscriber lists. " +
				"Use when you need a token-efficient overview of where stores live, not individual store details.",
		),
});

const ScanProjectOutputSchema = z.object({
	root: z.string(),
	filesScanned: z.number(),
	// Full mode (default): raw entity lists
	stores: z
		.array(
			z.object({
				id: z.string(),
				file: z.string(),
				line: z.number(),
				kind: z.string(), // StoreKind
				name: z.string().optional(),
			}),
		)
		.optional(),
	subscribers: z
		.array(
			z.object({
				id: z.string(),
				file: z.string(),
				line: z.number(),
				kind: z.string(), // SubscriberKind
				name: z.string().optional(),
				storeIds: z.array(z.string()),
			}),
		)
		.optional(),
	mutators: z
		.array(
			z.object({
				id: z.string(),
				file: z.string(),
				line: z.number(),
				kind: z.string(), // MutatorKind
				name: z.string().optional(),
				storeIds: z.array(z.string()),
			}),
		)
		.optional(),
	relations: z
		.array(
			z.object({
				type: z.enum(["declares", "subscribes_to", "derives_from", "mutates"]),
				from: z.string(),
				to: z.string(),
				file: z.string().optional(),
				line: z.number().optional(),
			}),
		)
		.optional(),
	// Compact mode: directory-level aggregates
	totals: z
		.object({
			stores: z.number(),
			subscribers: z.number(),
			mutators: z.number(),
			relations: z.number(),
		})
		.optional(),
	byDir: z
		.array(
			z.object({
				dir: z.string(),
				storeCount: z.number(),
				subscriberCount: z.number(),
				mutatorCount: z.number(),
				storeKinds: z.record(z.string(), z.number()),
			}),
		)
		.optional(),
	errors: z.array(z.string()).optional(),
});

export interface ScanProjectData {
	rootDir: string;
	filesScanned: number;
	stores: Array<{ id: string; file: string; line: number; kind: string; name?: string }>;
	subscribers: Array<{
		id: string;
		file: string;
		line: number;
		kind: string;
		name?: string;
		storeIds: string[];
	}>;
	mutators?: Array<{
		id: string;
		file: string;
		line: number;
		kind: string;
		name?: string;
		storeIds: string[];
	}>;
	relations: Array<{
		type: "declares" | "subscribes_to" | "derives_from" | "mutates";
		from: string;
		to: string;
		file?: string;
		line?: number;
	}>;
}

export function buildScanProjectResponse(
	result: ScanProjectData | null,
	error?: string,
	compact?: boolean,
): {
	content: Array<{ type: "text"; text: string }>;
	structuredContent: Record<string, unknown>;
} {
	const errors: string[] = [];

	let rootToReport = "";
	let filesScanned = 0;
	let stores: ScanProjectData["stores"] = [];
	let subscribers: ScanProjectData["subscribers"] = [];
	let mutators: NonNullable<ScanProjectData["mutators"]> = [];
	let relations: ScanProjectData["relations"] = [];

	if (error) {
		errors.push(`Failed to scan project: ${error}`);
	} else if (result) {
		rootToReport = result.rootDir;
		filesScanned = result.filesScanned;
		stores = result.stores;
		subscribers = result.subscribers;
		mutators = result.mutators ?? [];
		relations = result.relations;
	}

	const summaryLines: string[] = [];
	summaryLines.push(`Root: ${rootToReport || "<unknown>"}`);
	summaryLines.push(`Files scanned: ${filesScanned}`);

	let structuredContent: Record<string, unknown>;

	if (compact) {
		// Compact mode: directory-level aggregates, no raw entity lists
		summaryLines.push(
			`Nanostores stores: ${stores.length}, Subscribers: ${subscribers.length}, Mutators: ${mutators.length}`,
		);

		const dirStats = new Map<
			string,
			{ storeCount: number; subscriberCount: number; mutatorCount: number; storeKinds: Record<string, number> }
		>();

		const ensureDir = (dir: string) => {
			let entry = dirStats.get(dir);
			if (!entry) {
				entry = { storeCount: 0, subscriberCount: 0, mutatorCount: 0, storeKinds: {} };
				dirStats.set(dir, entry);
			}
			return entry;
		};

		for (const store of stores) {
			const dir = path.dirname(store.file);
			const entry = ensureDir(dir === "." ? "." : dir);
			entry.storeCount += 1;
			entry.storeKinds[store.kind] = (entry.storeKinds[store.kind] ?? 0) + 1;
		}
		for (const sub of subscribers) {
			const dir = path.dirname(sub.file);
			ensureDir(dir === "." ? "." : dir).subscriberCount += 1;
		}
		for (const mut of mutators) {
			const dir = path.dirname(mut.file);
			ensureDir(dir === "." ? "." : dir).mutatorCount += 1;
		}

		const byDir = Array.from(dirStats.entries())
			.map(([dir, s]) => ({ dir, ...s }))
			.sort((a, b) => b.storeCount - a.storeCount || a.dir.localeCompare(b.dir));

		if (byDir.length > 0) {
			summaryLines.push("");
			summaryLines.push("By directory:");
			for (const d of byDir) {
				const kindsStr = Object.entries(d.storeKinds)
					.map(([k, n]) => `${k}: ${n}`)
					.join(", ");
				summaryLines.push(
					`- ${d.dir}: ${d.storeCount} store(s)${kindsStr ? ` [${kindsStr}]` : ""}, ${d.subscriberCount} subscriber(s)`,
				);
			}
		}

		structuredContent = {
			root: rootToReport,
			filesScanned,
			totals: {
				stores: stores.length,
				subscribers: subscribers.length,
				mutators: mutators.length,
				relations: relations.length,
			},
			byDir,
			...(errors.length > 0 ? { errors } : {}),
		};
	} else {
		// Full mode: raw entity lists with previews
		summaryLines.push(`Nanostores stores: ${stores.length}`);
		summaryLines.push(`Subscribers (components/hooks/effects): ${subscribers.length}`);
		summaryLines.push(`Relations: ${relations.length}`);

		if (stores.length > 0) {
			const preview = stores.slice(0, 10);
			summaryLines.push("");
			summaryLines.push("First stores:");
			for (const store of preview) {
				const namePart = store.name ? ` ${store.name}` : "";
				summaryLines.push(`- [${store.kind}]${namePart} at ${store.file}:${store.line}`);
			}
		}

		if (subscribers.length > 0) {
			const preview = subscribers.slice(0, 10);
			summaryLines.push("");
			summaryLines.push("First subscribers:");
			for (const sub of preview) {
				const namePart = sub.name ? ` ${sub.name}` : "";
				summaryLines.push(
					`- [${sub.kind}]${namePart} at ${sub.file}:${sub.line} (stores: ${sub.storeIds.length})`,
				);
			}
		}

		structuredContent = {
			root: rootToReport,
			filesScanned,
			stores,
			subscribers,
			relations,
			...(errors.length > 0 ? { errors } : {}),
		};
	}

	if (errors.length > 0) {
		summaryLines.push("");
		summaryLines.push("Errors:");
		for (const e of errors) {
			summaryLines.push(`- ${e}`);
		}
	}

	return {
		content: [
			{
				type: "text" as const,
				text: summaryLines.join("\n"),
			},
		],
		structuredContent,
	};
}

export function registerScanProjectTool(
	server: McpServer,
	projectService: ProjectAnalysisService,
	onResourcesChanged?: () => void,
): void {
	server.registerTool(
		TOOLS.scanProject,
		{
			title: "Scan project for Nanostores usage",
			description:
				"Returns the complete store/subscriber/relation index for the project. " +
				"Use compact:true for a token-efficient directory-level overview (store counts by folder). " +
				"Use the full mode (default) when you need to iterate over every entity or build a complete picture. " +
				"Example: {compact: true} for directory overview, {force: true} to bypass cache.",
			inputSchema: ScanProjectInputSchema,
			outputSchema: ScanProjectOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ rootUri, force, compact }, extra) => {
			try {
				const rootPath = resolveWorkspaceRoot(rootUri);
				const onProgress = createMcpProgressCallback(extra);
				const result = await projectService.getIndex(rootPath, {
					force,
					onProgress,
				});
				onResourcesChanged?.();
				return {
					...buildScanProjectResponse(result, undefined, compact),
					resourceLinks: [{ uri: URIS.graph }],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				return {
					...buildScanProjectResponse(null, msg),
					isError: true,
				};
			}
		},
	);
}
