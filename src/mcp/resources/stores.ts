import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

export function registerStoresResource(server: McpServer): void {
	server.registerResource(
		"stores",
		"nanostores://stores",
		{
			title: "Nanostores stores overview",
			description: "Aggregated list of nanostores stores discovered in the current project.",
		},
		async uri => {
			let summaryText = "";
			let jsonText = "";

			try {
				const rootPath = resolveWorkspaceRoot();
				const result = await scanProject(rootPath);

				const { rootDir, filesScanned, stores } = result;

				const lines: string[] = [];

				lines.push(`Root: ${rootDir}`);
				lines.push(`Files scanned: ${filesScanned}`);
				lines.push(`Nanostores stores found: ${stores.length}`);

				if (stores.length > 0) {
					lines.push("");
					lines.push("First matches:");

					const preview = stores.slice(0, 20);
					for (const store of preview) {
						const namePart = store.name ? ` (${store.name})` : "";
						lines.push(`- [${store.kind}]${namePart} at ${store.file}:${store.line}`);
					}

					if (stores.length > preview.length) {
						lines.push(`… and ${stores.length - preview.length} more`);
					}
				}

				summaryText = lines.join("\n");
				jsonText = JSON.stringify(result, null, 2);
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				summaryText = "Failed to scan project for nanostores stores.\n\n" + `Error: ${msg}`;
				jsonText = JSON.stringify(
					{
						error: msg,
					},
					null,
					2,
				);
			}

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
						text: jsonText,
					},
				],
			};
		},
	);
}
