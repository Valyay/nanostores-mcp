import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import { URIS } from "../uris.js";
import { resolveStore, collectStoreNeighbors } from "../../domain/storeLookup.js";

/**
 * Ресурс одного стора:
 *
 *   nanostores://store/{key}
 *
 * Где key может быть:
 *   1) полным id стора:
 *      "store:src/stores/cart.ts#$cartTotal"
 *   2) именем стора:
 *      "$cartTotal" или "cartTotal"
 *
 * Это удобно:
 *   - для ссылок из графа: используем id;
 *   - для пользователя / промптов: используем имя.
 */
export function registerStoreResource(server: McpServer): void {
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

			let index;
			try {
				index = await scanProject(rootPath);
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text:
								"Failed to scan project for Nanostores store.\n\n" +
								`Root: ${rootPath}\n` +
								`Error: ${msg}`,
						},
					],
				};
			}

			const keyValue = Array.isArray(key) ? key[0] : key;
			const rawKey = decodeURIComponent(keyValue);

			// Resolve store using domain logic
			const resolution = resolveStore(index, rawKey);

			if (!resolution) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text:
								`Store not found.\n\n` +
								`Requested key: ${rawKey}\n` +
								`Root: ${index.rootDir}\n` +
								`Known stores: ${index.stores.length}`,
						},
					],
				};
			}

			const { store, note: resolutionNote } = resolution;

			// Collect neighbors using domain logic
			const {
				subscribers,
				derivesFromStores,
				derivesFromEdges,
				dependentsStores,
				dependentsEdges,
			} = collectStoreNeighbors(index, store);

			// --- краткое текстовое описание ---

			const summary: string[] = [];

			summary.push(`Store: ${store.name ?? store.id}`);
			summary.push(`Kind: ${store.kind}`);
			summary.push(`File: ${store.file}:${store.line}`);
			if (resolutionNote) {
				summary.push("");
				summary.push(resolutionNote);
			}
			summary.push("");

			// derives from
			if (derivesFromStores.length > 0) {
				summary.push("Derives from:");
				for (const s of derivesFromStores) {
					summary.push(`- ${s.name ?? s.id} (${s.file}:${s.line})`);
				}
			} else {
				summary.push("Derives from: none (base store)");
			}

			// dependents
			if (dependentsStores.length > 0) {
				summary.push("");
				summary.push("Derived dependents:");
				for (const s of dependentsStores) {
					summary.push(`- ${s.name ?? s.id} (${s.file}:${s.line})`);
				}
			} else {
				summary.push("");
				summary.push("Derived dependents: none");
			}

			// subscribers
			if (subscribers.length > 0) {
				summary.push("");
				summary.push("Subscribers (components/hooks/effects):");
				for (const sub of subscribers) {
					const displayName = sub.name || sub.id;
					summary.push(`- [${sub.kind}] ${displayName} (${sub.file}:${sub.line})`);
				}
			} else {
				summary.push("");
				summary.push("Subscribers: none found");
			}

			const structuredContent = {
				store,
				resolution: {
					requestedKey: rawKey,
					note: resolutionNote || undefined,
				},
				subscribers,
				derivesFrom: {
					stores: derivesFromStores,
					relations: derivesFromEdges,
				},
				derivedDependents: {
					stores: dependentsStores,
					relations: dependentsEdges,
				},
			};

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: summary.join("\n"),
					},
					{
						uri: `${uri.href}#json`,
						mimeType: "application/json",
						text: JSON.stringify(structuredContent, null, 2),
					},
				],
				structuredContent,
			};
		},
	);
}
