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
				"Scans the project for nanostores imports and basic store declarations (const name = atom/map/computed(...)).",
			inputSchema: {
				// Можно будет задокументировать, что это file:// или путь внутри roots
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

			try {
				const rootPath = resolveWorkspaceRoot(rootUri);
				rootToReport = rootPath;

				const result = await scanProject(rootPath);
				rootToReport = result.rootDir;
				filesScanned = result.filesScanned;
				stores = result.stores;
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
				errors.push(`Failed to scan project: ${msg}`);
			}

			const summaryLines: string[] = [];

			summaryLines.push(`Root: ${rootToReport || "<unknown>"}`);
			summaryLines.push(`Files scanned: ${filesScanned}`);
			summaryLines.push(`Nanostores stores found: ${stores.length}`);

			if (stores.length > 0) {
				const preview = stores.slice(0, 10);
				summaryLines.push("");
				summaryLines.push("First matches:");

				for (const store of preview) {
					const namePart = store.name ? ` (${store.name})` : "";
					summaryLines.push(`- [${store.kind}]${namePart} at ${store.file}:${store.line}`);
				}

				if (stores.length > preview.length) {
					summaryLines.push(`… and ${stores.length - preview.length} more`);
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
