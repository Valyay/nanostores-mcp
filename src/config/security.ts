import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Нормализация пути:
 * - снимаем относительность (., ..)
 * - убираем лишние слэши и т.п.
 */
export function normalizeFsPath(fsPath: string): string {
	return path.resolve(fsPath);
}

/**
 * Переводим file:// URI или обычную строку в нормализованный FS-путь.
 */
export function uriToFsPath(uriOrPath: string): string {
	// file://
	if (uriOrPath.startsWith("file://")) {
		const url = new URL(uriOrPath);
		return normalizeFsPath(fileURLToPath(url));
	}

	// считаем, что это и так путь (абсолютный или относительный)
	return normalizeFsPath(uriOrPath);
}

/**
 * Проверяем, что target лежит внутри root (или совпадает с ним).
 */
export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
	const target = normalizeFsPath(targetPath);
	const root = normalizeFsPath(rootPath);

	if (target === root) return true;

	const rel = path.relative(root, target);

	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Переводит строку (URI или путь) в FS-путь и гарантирует,
 * что он лежит внутри хотя бы одного из roots.
 *
 * Если нет ни одного root или путь вне всех — кидаем ошибку.
 */
export function resolveSafePath(uriOrPath: string, roots: readonly string[]): string {
	if (!roots.length) {
		throw new Error("No workspace roots configured; cannot safely resolve filesystem path.");
	}

	const fsPath = uriToFsPath(uriOrPath);

	for (const root of roots) {
		if (isPathInsideRoot(fsPath, root)) {
			return fsPath;
		}
	}

	const rootsList = roots.join(", ");
	throw new Error(`Path "${fsPath}" is outside of allowed roots: ${rootsList}`);
}
