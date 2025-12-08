import { scanProject } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

/**
 * Simple cache for store names to avoid running scanProject on every completion.
 */
let cachedRoot: string | null = null;
let cachedStoreNames: string[] = [];

/**
 * Get the list of all store names for the current workspace root.
 * Uses cache to avoid scanning the project on every call.
 */
export async function getStoreNamesForCurrentRoot(): Promise<string[]> {
	const root = resolveWorkspaceRoot();

	if (cachedRoot === root && cachedStoreNames.length > 0) {
		return cachedStoreNames;
	}

	try {
		const index = await scanProject(root);
		const names = index.stores.map(s => s.name ?? "").filter(n => n.trim().length > 0);

		const unique = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));

		cachedRoot = root;
		cachedStoreNames = unique;

		return unique;
	} catch {
		return cachedStoreNames;
	}
}

/**
 * Get autocomplete suggestions for store names.
 * Filters by substring (case-insensitive) and returns up to 20 results.
 *
 * @param value - User input value for filtering
 * @returns Array of matching store names
 */
export async function suggestStoreNames(value: string): Promise<string[]> {
	const allNames = await getStoreNamesForCurrentRoot();

	if (!value.trim()) {
		return allNames.slice(0, 20);
	}

	const q = value.toLowerCase();

	return allNames.filter(name => name.toLowerCase().includes(q)).slice(0, 20);
}
