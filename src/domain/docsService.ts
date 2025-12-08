import type { DocsRepository } from "./docsIndex.js";
import type {
	DocsIndex,
	DocPage,
	DocChunk,
	DocsSearchResult,
	DocsSearchOptions,
} from "./docsTypes.js";
import type { StoreKind } from "./fsScanner/index.js";

/**
 * Service interface for documentation operations
 * Facade over DocsRepository with additional convenience methods
 */
export interface DocsService {
	/**
	 * Search documentation by query string
	 */
	search(query: string, options?: DocsSearchOptions): Promise<DocsSearchResult>;

	/**
	 * Get a specific documentation page by ID
	 */
	getPage(id: string): Promise<DocPage | null>;

	/**
	 * Get all chunks for a specific page
	 */
	getPageChunks(pageId: string): Promise<DocChunk[]>;

	/**
	 * Find documentation pages relevant to a specific store kind
	 * Returns pages tagged with the store kind
	 */
	findForStore(kind: StoreKind): Promise<DocPage[]>;

	/**
	 * Get the full documentation index
	 */
	getIndex(): Promise<DocsIndex>;

	/**
	 * Get all available tags
	 */
	getTags(): Promise<string[]>;
}

/**
 * Create a docs service that wraps a DocsRepository
 */
export function createDocsService(repository: DocsRepository): DocsService {
	/**
	 * Map store kinds to relevant documentation tags
	 */
	function getTagsForStoreKind(kind: StoreKind): string[] {
		switch (kind) {
			case "atom":
				return ["atom", "core"];
			case "map":
				return ["map", "core"];
			case "computed":
				return ["computed", "core"];
			case "persistentAtom":
			case "persistentMap":
				return ["persistent", kind === "persistentAtom" ? "atom" : "map"];
			case "atomFamily":
				return ["atom", "family", "core"];
			case "mapTemplate":
				return ["map", "template", "core"];
			case "computedTemplate":
				return ["computed", "template", "core"];
			case "unknown":
			default:
				return ["core"];
		}
	}

	return {
		async search(query: string, options?: DocsSearchOptions): Promise<DocsSearchResult> {
			return repository.search(query, options);
		},

		async getPage(id: string): Promise<DocPage | null> {
			const page = await repository.getPageById(id);
			return page ?? null;
		},

		async getPageChunks(pageId: string): Promise<DocChunk[]> {
			return repository.getChunksByPageId(pageId);
		},

		async findForStore(kind: StoreKind): Promise<DocPage[]> {
			const index = await repository.getIndex();
			const relevantTags = getTagsForStoreKind(kind);

			// Find pages that have at least one relevant tag
			const matchingPages = index.pages.filter(page =>
				page.tags.some(tag => relevantTags.includes(tag)),
			);

			// Sort by relevance (more matching tags = higher priority)
			matchingPages.sort((a, b) => {
				const aMatches = a.tags.filter(tag => relevantTags.includes(tag)).length;
				const bMatches = b.tags.filter(tag => relevantTags.includes(tag)).length;
				return bMatches - aMatches;
			});

			return matchingPages;
		},

		async getIndex(): Promise<DocsIndex> {
			return repository.getIndex();
		},

		async getTags(): Promise<string[]> {
			const index = await repository.getIndex();
			const tags = new Set<string>();

			for (const page of index.pages) {
				for (const tag of page.tags) {
					tags.add(tag);
				}
			}

			return Array.from(tags).sort();
		},
	};
}
