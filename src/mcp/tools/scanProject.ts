import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

export function registerScanProjectTool(server: McpServer): void {
	server.registerTool(
		"scan_project",
		{
			title: "Scan project for Nanostores usage",
			description:
				"Scans the project for nanostores imports, store declarations, consumers, and basic relations.",
			inputSchema: {
				// file:// URI или путь внутри workspace roots; если не указан — берётся первый root
				rootUri: z.string().optional(),
			},
			outputSchema: {
				root: z.string(),
				filesScanned: z.number(),
				stores: z.array(
					z.object({
						id: z.string(),
						file: z.string(),
						line: z.number(),
						kind: z.string(),
						name: z.string().optional(),
					}),
				),
				consumers: z.array(
					z.object({
						id: z.string(),
						file: z.string(),
						kind: z.string(),
						name: z.string().optional(),
						line: z.number().optional(),
					}),
				),
				relations: z.array(
					z.object({
						type: z.enum(["declares", "uses", "depends_on"]),
						from: z.string(),
						to: z.string(),
						file: z.string().optional(),
						line: z.number().optional(),
					}),
				),
				errors: z.array(z.string()).optional(),
			},
		},
		async ({ rootUri }) => {
			const errors: string[] = [];

			let rootToReport = rootUri ?? "";
			let filesScanned = 0;

			let stores: Array<{
				id: string;
				file: string;
				line: number;
				kind: string;
				name?: string;
			}> = [];

			let consumers: Array<{
				id: string;
				file: string;
				kind: string;
				name?: string;
				line?: number;
			}> = [];

			let relations: Array<{
				type: "declares" | "uses" | "depends_on";
				from: string;
				to: string;
				file?: string;
				line?: number;
			}> = [];

			try {
				// ВАЖНО: ошибки resolveWorkspaceRoot (roots/security) тоже ловим здесь
				const rootPath = resolveWorkspaceRoot(rootUri);
				rootToReport = rootPath;

				const result = await scanProject(rootPath);

				rootToReport = result.rootDir;
				filesScanned = result.filesScanned;
				stores = result.stores;
				consumers = result.consumers;
				relations = result.relations;
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				errors.push(`Failed to scan project: ${msg}`);
			}

			const summaryLines: string[] = [];

			summaryLines.push(`Root: ${rootToReport || "<unknown>"}`);
			summaryLines.push(`Files scanned: ${filesScanned}`);
			summaryLines.push(`Nanostores stores found: ${stores.length}`);
			summaryLines.push(`Consumers found: ${consumers.length}`);
			summaryLines.push(`Relations found: ${relations.length}`);

			if (stores.length > 0) {
				const preview = stores.slice(0, 10);
				summaryLines.push("");
				summaryLines.push("First store matches:");
				for (const store of preview) {
					const namePart = store.name ? ` (${store.name})` : "";
					summaryLines.push(`- [${store.kind}]${namePart} at ${store.file}:${store.line}`);
				}
				if (stores.length > preview.length) {
					summaryLines.push(`… and ${stores.length - preview.length} more`);
				}
			}

			if (consumers.length > 0) {
				const previewConsumers = consumers.slice(0, 10);
				summaryLines.push("");
				summaryLines.push("First consumers:");
				for (const consumer of previewConsumers) {
					const namePart = consumer.name ? ` (${consumer.name})` : "";
					const linePart = consumer.line ? `:${consumer.line}` : "";
					summaryLines.push(`- [${consumer.kind}]${namePart} in ${consumer.file}${linePart}`);
				}
				if (consumers.length > previewConsumers.length) {
					summaryLines.push(`… and ${consumers.length - previewConsumers.length} more`);
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
				consumers,
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
