// src/config/settings.ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeFsPath, resolveSafePath } from "./security.js";

export interface WorkspaceRoot {
	/** Оригинальный URI (если есть) или сгенерированный из fsPath. */
	uri: string;
	/** Человекочитаемое имя root (опционально). */
	name?: string;
	/** Нормализованный путь в файловой системе. */
	fsPath: string;
}

let cachedEnvRoots: string[] | null = null;
let cachedWorkspaceRoots: WorkspaceRoot[] | null = null;

/**
 * Читаем roots из окружения.
 *
 * Поддерживаем:
 * - NANOSTORES_MCP_ROOTS — список через path.delimiter (/foo:/bar или /foo;/bar)
 * - NANOSTORES_MCP_ROOT  — одиночный путь
 * - WORKSPACE_FOLDER_PATHS / WORKSPACE_FOLDER — как у некоторых хостов (Cursor и т.п.)
 */
export function getEnvWorkspaceRoots(): string[] {
	if (cachedEnvRoots) return cachedEnvRoots;

	const roots: string[] = [];
	const delimiter = path.delimiter;

	const multi = process.env.NANOSTORES_MCP_ROOTS;
	if (multi) {
		for (const raw of multi.split(delimiter)) {
			const trimmed = raw.trim();
			if (trimmed) roots.push(normalizeFsPath(trimmed));
		}
	}

	const single =
		process.env.NANOSTORES_MCP_ROOT ||
		process.env.WORKSPACE_FOLDER ||
		process.env.WORKSPACE_FOLDER_PATHS;

	if (single) {
		for (const raw of single.split(delimiter)) {
			const trimmed = raw.trim();
			if (trimmed) roots.push(normalizeFsPath(trimmed));
		}
	}

	cachedEnvRoots = Array.from(new Set(roots));
	return cachedEnvRoots;
}

/**
 * Основной источник прав доступа к FS для nanostores-mcp.
 *
 * Сейчас приоритет такой:
 * 1. Явные roots из env (NANOSTORES_MCP_ROOTS / NANOSTORES_MCP_ROOT / WORKSPACE_*).
 * 2. process.cwd() как единственный root.
 *
 * ⚠️ Реальный MCP roots/list от клиента можно будет добавить сюда позже.
 */
export function getWorkspaceRoots(): WorkspaceRoot[] {
	if (cachedWorkspaceRoots) return cachedWorkspaceRoots;

	const envRoots = getEnvWorkspaceRoots();

	const fsRoots: string[] = envRoots.length ? envRoots : [normalizeFsPath(process.cwd())];

	cachedWorkspaceRoots = fsRoots.map(fsPath => ({
		fsPath,
		uri: pathToFileURL(fsPath).href,
		name: undefined,
	}));

	return cachedWorkspaceRoots;
}

/**
 * Только FS-пути из корней.
 */
export function getWorkspaceRootPaths(): string[] {
	return getWorkspaceRoots().map(root => root.fsPath);
}

/**
 * Разрешаем любой uri/path так, чтобы он точно лежал
 * внутри текущих workspace roots.
 *
 * Если путь вылазит за пределы — кидаем ошибку.
 */
export function resolveWorkspacePath(uriOrPath: string): string {
	const roots = getWorkspaceRootPaths();
	return resolveSafePath(uriOrPath, roots);
}

/**
 * Твой старый API, но теперь с учётом roots.
 *
 * 1) Если rootUri не передан — берём первый root.
 * 2) Если передан — пытаемся безопасно его резолвнуть внутри roots.
 */
export function resolveWorkspaceRoot(rootUri?: string): string {
	const roots = getWorkspaceRootPaths();
	if (!roots.length) {
		// на всякий случай, но по идее сюда не дойдём
		return normalizeFsPath(process.cwd());
	}

	if (!rootUri || rootUri.trim().length === 0) {
		return roots[0];
	}

	// если rootUri file:// или относительный/абсолютный путь — проверяем, что он внутри roots
	return resolveWorkspacePath(rootUri);
}
