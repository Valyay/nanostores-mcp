import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

const ScanProjectInputSchema = z.object({
	// file:// URI или путь внутри workspace; если не указан — берётся первый root
	rootUri: z.string().optional(),
});

const ScanProjectOutputSchema = z.object({
	root: z.string(),
	filesScanned: z.number(),
	stores: z.array(
		z.object({
			id: z.string(),
			file: z.string(),
			line: z.number(),
			kind: z.string(), // StoreKind
			name: z.string().optional(),
		}),
	),
	subscribers: z.array(
		z.object({
			id: z.string(),
			file: z.string(),
			line: z.number(),
			kind: z.string(), // SubscriberKind
			name: z.string().optional(),
			storeIds: z.array(z.string()),
		}),
	),
	relations: z.array(
		z.object({
			type: z.enum(["declares", "subscribes_to", "derives_from"]),
			from: z.string(),
			to: z.string(),
			file: z.string().optional(),
			line: z.number().optional(),
		}),
	),
	errors: z.array(z.string()).optional(),
});

export function registerScanProjectTool(server: McpServer): void {
	server.registerTool(
		"scan_project",
		{
			title: "Scan project for Nanostores usage",
			description:
				"Scans the project for nanostores stores, subscribers (components/hooks) and simple store-to-store dependencies.",
			inputSchema: ScanProjectInputSchema,
			outputSchema: ScanProjectOutputSchema,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ rootUri }, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
			const errors: string[] = [];
			const progressToken = extra._meta?.progressToken;

			// Helper to send progress notifications if client requested them
			const reportProgress = async (
				progress: number,
				total: number,
				message: string,
			): Promise<void> => {
				if (progressToken !== undefined) {
					await extra.sendNotification({
						method: "notifications/progress",
						params: {
							progressToken,
							progress,
							total,
							message,
						},
					});
				}
			};

			let rootToReport = "";
			let filesScanned = 0;
			let stores: Array<{
				id: string;
				file: string;
				line: number;
				kind: string;
				name?: string;
			}> = [];
			let subscribers: Array<{
				id: string;
				file: string;
				line: number;
				kind: string;
				name?: string;
				storeIds: string[];
			}> = [];
			let relations: Array<{
				type: "declares" | "subscribes_to" | "derives_from";
				from: string;
				to: string;
				file?: string;
				line?: number;
			}> = [];

			try {
				const rootPath = resolveWorkspaceRoot(rootUri);
				rootToReport = rootPath;

				const result = await scanProject(rootPath, {
					onProgress: (progress, total, message) => {
						// Fire-and-forget: we don't await to avoid blocking scan
						void reportProgress(progress, total, message);
					},
				});

				rootToReport = result.rootDir;
				filesScanned = result.filesScanned;
				stores = result.stores;
				subscribers = result.subscribers;
				relations = result.relations;
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				errors.push(`Failed to scan project: ${msg}`);
			}

			const summaryLines: string[] = [];

			summaryLines.push(`Root: ${rootToReport || "<unknown>"}`);
			summaryLines.push(`Files scanned: ${filesScanned}`);
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

			if (errors.length > 0) {
				summaryLines.push("");
				summaryLines.push("Errors:");
				for (const e of errors) {
					summaryLines.push(`- ${e}`);
				}
			}

			const structuredContent = {
				root: rootToReport,
				filesScanned,
				stores,
				subscribers,
				relations,
				...(errors.length > 0 ? { errors } : {}),
			};

			return {
				content: [
					{
						type: "text",
						text: summaryLines.join("\n"),
					},
				],
				structuredContent,
			};
		},
	);
}
