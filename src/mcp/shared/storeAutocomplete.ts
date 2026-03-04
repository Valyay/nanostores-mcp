import type { ProjectAnalysisService } from "../../domain/index.js";
import { resolveWorkspaceRoot } from "../../config/settings.js";

/**
 * Callback type for store name autocomplete, used by prompt registrations.
 */
export type SuggestStoreNamesFn = (value: string) => Promise<string[]>;

export interface StoreAutocompleteFns {
	suggestStoreNames: SuggestStoreNamesFn;
	resetCache: () => void;
}

export function deduplicateAndSort(names: string[]): string[] {
	return Array.from(new Set(names.filter(n => n.trim().length > 0))).sort((a, b) =>
		a.localeCompare(b),
	);
}

export function filterStoreNames(allNames: string[], value: string, limit = 20): string[] {
	if (!value.trim()) {
		return allNames.slice(0, limit);
	}
	const q = value.toLowerCase();
	return allNames.filter(name => name.toLowerCase().includes(q)).slice(0, limit);
}

/**
 * Creates autocomplete functions bound to a ProjectAnalysisService.
 * Uses the service's built-in cache instead of maintaining a separate scanner call.
 * A lightweight name cache avoids extracting names on every keystroke.
 */
export function createStoreAutocomplete(
	projectService: ProjectAnalysisService,
): StoreAutocompleteFns {
	let cachedRoot: string | null = null;
	let cachedNames: string[] = [];

	async function getNames(): Promise<string[]> {
		const root = resolveWorkspaceRoot();
		if (cachedRoot === root && cachedNames.length > 0) {
			return cachedNames;
		}
		try {
			const names = await projectService.getStoreNames(root);
			cachedRoot = root;
			cachedNames = names;
			return names;
		} catch {
			return cachedNames;
		}
	}

	return {
		async suggestStoreNames(value: string): Promise<string[]> {
			const allNames = await getNames();
			return filterStoreNames(allNames, value);
		},
		resetCache(): void {
			cachedRoot = null;
			cachedNames = [];
		},
	};
}
