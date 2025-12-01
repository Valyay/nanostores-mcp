import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";
import type { StoreMatch, SubscriberMatch, StoreRelation } from "../../domain/fsScanner.js";

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
		new ResourceTemplate("nanostores://store/{key}", {
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

			// --- находим store по id или по имени ---

			let store: StoreMatch | undefined;
			let resolutionNote = "";

			// 1) если key похож на полный id (store:...#...), ищем по id
			if (rawKey.startsWith("store:")) {
				store = index.stores.find(s => s.id === rawKey);
				resolutionNote = `Resolved by id: ${rawKey}`;
			} else {
				// 2) иначе считаем, что это имя сторы
				// поддерживаем:
				//   "$counter" и "counter" (добавим/уберём $)
				const nameCandidates = new Set<string>();

				if (rawKey.startsWith("$")) {
					nameCandidates.add(rawKey); // "$counter"
					nameCandidates.add(rawKey.slice(1)); // "counter"
				} else {
					nameCandidates.add(rawKey); // "counter"
					nameCandidates.add(`$${rawKey}`); // "$counter"
				}

				const nameMatches = index.stores.filter(s => s.name && nameCandidates.has(s.name));

				if (nameMatches.length === 1) {
					store = nameMatches[0];
					resolutionNote = `Resolved by name: ${rawKey}`;
				} else if (nameMatches.length > 1) {
					// если несколько — берём первый по сортировке, но даём знать пользователю
					nameMatches.sort((a, b) => a.file.localeCompare(b.file));
					store = nameMatches[0];

					const others = nameMatches
						.slice(1)
						.map(s => s.file)
						.join(", ");

					resolutionNote =
						`Resolved by name: ${rawKey} (multiple matches, using first).\n` +
						`Other matches in files: ${others}`;
				} else {
					// 3) fallback: вдруг передали кусок id без 'store:'?
					const idMatches = index.stores.filter(
						s => s.id === rawKey || s.id.endsWith(`#${rawKey}`) || s.id.endsWith(`#$${rawKey}`),
					);

					if (idMatches.length === 1) {
						store = idMatches[0];
						resolutionNote = `Resolved by id tail: ${rawKey}`;
					} else if (idMatches.length > 1) {
						idMatches.sort((a, b) => a.file.localeCompare(b.file));
						store = idMatches[0];
						const others = idMatches
							.slice(1)
							.map(s => s.file)
							.join(", ");
						resolutionNote =
							`Resolved by id tail: ${rawKey} (multiple matches, using first).\n` +
							`Other matches in files: ${others}`;
					}
				}
			}

			if (!store) {
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

			// --- соседи стора ---

			const allRelations: StoreRelation[] = index.relations;

			// подписчики (components/hooks/effects), которые завязаны на этот стор
			const subscribers: SubscriberMatch[] = index.subscribers.filter(sub =>
				sub.storeIds.includes(store.id),
			);

			// store, от которых этот стор зависит (он derived от них)
			const derivesFromEdges = allRelations.filter(
				r => r.type === "derives_from" && r.from === store.id,
			);
			const derivesFromIds = new Set(derivesFromEdges.map(r => r.to));
			const derivesFromStores: StoreMatch[] = index.stores.filter(s => derivesFromIds.has(s.id));

			// store, которые зависят от этого стора (они derived-наследники)
			const dependentsEdges = allRelations.filter(
				r => r.type === "derives_from" && r.to === store.id,
			);
			const dependentsIds = new Set(dependentsEdges.map(r => r.from));
			const dependentsStores: StoreMatch[] = index.stores.filter(s => dependentsIds.has(s.id));

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
