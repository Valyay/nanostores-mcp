import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanProject } from "../../domain/fsScanner.js";
import { URIS } from "../uris.js";
import {
	buildStoreGraph,
	type StoreGraph,
	type StoreNode,
	type SubscriberNode,
} from "../../domain/graphBuilder.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

function sanitizeId(id: string): string {
	// Mermaid плохо переваривает двоеточия, слэши и т.п.
	return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Санитизирует label для использования внутри Mermaid node label.
 * Экранирует или удаляет спецсимволы, которые могут сломать парсинг Mermaid.
 */
function sanitizeLabel(label: string): string {
	// Заменяем кавычки и скобки, которые могут сломать Mermaid
	return label
		.replace(/"/g, "'") // двойные кавычки → одинарные
		.replace(/\[/g, "(") // квадратные скобки → круглые
		.replace(/\]/g, ")")
		.replace(/</g, "‹") // угловые скобки → типографские
		.replace(/>/g, "›")
		.replace(/\{/g, "(") // фигурные скобки → круглые
		.replace(/\}/g, ")")
		.replace(/\|/g, "¦") // pipe → broken bar
		.replace(/\n/g, " ") // переводы строки → пробелы
		.trim();
}

function kindLabelForSubscriber(kind: SubscriberNode["kind"]): string {
	switch (kind) {
		case "component":
			return "component";
		case "hook":
			return "hook";
		case "effect":
			return "effect";
		default:
			return "subscriber";
	}
}

function displayNameForSubscriber(sub: SubscriberNode): string {
	// Если name задано — используем его
	if (sub.name && sub.name !== sub.id) return sub.name;
	// Иначе берём базовое имя файла (App из src/App.tsx)
	const base = path.basename(sub.file || "", path.extname(sub.file || ""));
	return base || sub.label;
}

function displayNameForStore(store: StoreNode): string {
	if (store.name && store.name !== store.id) return store.name;
	return store.label;
}

/**
 * Собираем mermaid-диаграмму:
 * - группируем stores и subscribers по файлам через subgraph
 * - рёбра показываем в data-flow виде:
 *   - store -> subscriber (updates)
 *   - baseStore -> derivedStore (derives)
 */
export function buildMermaidFromGraph(graph: StoreGraph): string {
	const lines: string[] = [];

	lines.push("graph LR");

	// Группируем узлы по файлам, игнорируя file-узлы (тип 'file')
	const byFile = new Map<
		string,
		{
			stores: StoreNode[];
			subscribers: SubscriberNode[];
		}
	>();

	for (const node of graph.nodes) {
		if (node.type === "store") {
			const store = node as StoreNode;
			const file = store.file || "unknown";
			let bucket = byFile.get(file);
			if (!bucket) {
				bucket = { stores: [], subscribers: [] };
				byFile.set(file, bucket);
			}
			bucket.stores.push(store);
		} else if (node.type === "subscriber") {
			const sub = node as SubscriberNode;
			const file = sub.file || "unknown";
			let bucket = byFile.get(file);
			if (!bucket) {
				bucket = { stores: [], subscribers: [] };
				byFile.set(file, bucket);
			}
			bucket.subscribers.push(sub);
		}
	}

	// Сопоставляем id узла → mermaid-id, чтобы потом рисовать рёбра
	const nodeIdMap = new Map<string, string>();

	// Рисуем subgraph по каждому файлу
	const sortedFiles = Array.from(byFile.keys()).sort((a, b) => a.localeCompare(b));

	for (const file of sortedFiles) {
		const bucket = byFile.get(file);
		if (!bucket) continue;

		const title = sanitizeLabel(file);

		lines.push(`subgraph "${title}"`);

		// stores
		for (const store of bucket.stores) {
			const mid = sanitizeId(store.id);
			nodeIdMap.set(store.id, mid);

			const display = sanitizeLabel(displayNameForStore(store));
			const kind = sanitizeLabel(store.kind ?? "store");

			lines.push(`${mid}["🧱 ${display} (${kind})"]`);
		}

		// subscribers
		for (const sub of bucket.subscribers) {
			const mid = sanitizeId(sub.id);
			nodeIdMap.set(sub.id, mid);

			const display = sanitizeLabel(displayNameForSubscriber(sub));
			const kindLabel = sanitizeLabel(kindLabelForSubscriber(sub.kind));

			lines.push(`${mid}["🧩 ${display} (${kindLabel})"]`);
		}

		lines.push("end");
	}

	// Рисуем рёбра.
	// Внутренний граф:
	//   - declares: file -> store (не рисуем в Mermaid, файл уже виден как subgraph)
	//   - subscribes_to: subscriber -> store
	//   - derives_from: derived -> base
	//
	// Для Mermaid разворачиваем в data-flow:
	//   - store --> subscriber (updates)
	//   - baseStore --> derivedStore (derives)
	for (const edge of graph.edges) {
		if (edge.type === "declares") {
			// пропускаем, достаточно того, что узлы сгруппированы по файлам
			continue;
		}

		let fromId = edge.from;
		let toId = edge.to;
		let label = "";

		if (edge.type === "subscribes_to") {
			// в индексе: subscriber -> store (зависит от)
			// в визуализации: store -> subscriber (куда течёт изменение)
			[fromId, toId] = [edge.to, edge.from];
			label = "updates";
		} else if (edge.type === "derives_from") {
			// в индексе: derived -> base
			// в визуализации: base -> derived
			[fromId, toId] = [edge.to, edge.from];
			label = "derives";
		} else {
			// на всякий случай, если появятся новые типы
			label = edge.type;
		}

		const fromMid = nodeIdMap.get(fromId);
		const toMid = nodeIdMap.get(toId);

		// Если один из концов — file-узел (мы его не рисовали), просто пропускаем
		if (!fromMid || !toMid) continue;

		if (label) {
			lines.push(`${fromMid} -->|${label}| ${toMid}`);
		} else {
			lines.push(`${fromMid} --> ${toMid}`);
		}
	}

	return lines.join("\n");
}

export function registerGraphMermaidResource(server: McpServer): void {
	server.registerResource(
		"graph-mermaid",
		URIS.graphMermaid,
		{
			title: "Nanostores project graph (Mermaid)",
			description:
				"Graph representation of Nanostores stores and subscribers (components/hooks/effects) as a Mermaid diagram.",
		},
		async uri => {
			try {
				const rootPath = resolveWorkspaceRoot();
				const index = await scanProject(rootPath);
				const graph = buildStoreGraph(index);

				const mermaid = buildMermaidFromGraph(graph);
				const markdown = ["```mermaid", mermaid, "```"].join("\n");

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/markdown",
							text: markdown,
						},
						{
							uri: `${uri.href}#mermaid`,
							mimeType: "text/plain",
							text: mermaid,
						},
					],
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "text/plain",
							text: "Failed to build Nanostores Mermaid graph.\n\n" + `Error: ${msg}`,
						},
					],
				};
			}
		},
	);
}
