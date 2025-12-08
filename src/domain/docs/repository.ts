import { basename } from "node:path";
import type {
	DocChunk,
	DocHeading,
	DocPage,
	DocsIndex,
	DocsSearchHit,
	DocsSearchOptions,
	DocsSearchResult,
} from "./types.js";
import type { DocsSource } from "./sourceFs.js";

/**
 * Options for docs indexing
 */
export interface DocsIndexOptions {
	maxChunkLength?: number;
	cacheTtlMs?: number;
}

/**
 * Repository interface for documentation
 */
export interface DocsRepository {
	getIndex(): Promise<DocsIndex>;
	search(query: string, options?: DocsSearchOptions): Promise<DocsSearchResult>;
	getPageById(id: string): Promise<DocPage | undefined>;
	getChunksByPageId(pageId: string): Promise<DocChunk[]>;
}

/**
 * Internal state for docs repository
 */
interface DocsRepositoryState {
	source: DocsSource;
	options: Required<DocsIndexOptions>;
	cachedIndex: DocsIndex | null;
	lastBuildTime: number;
}

/**
 * Parse markdown headings from text
 */
function parseHeadings(text: string): DocHeading[] {
	const headings: DocHeading[] = [];
	const lines = text.split("\n");
	let offset = 0;

	for (const line of lines) {
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			const level = match[1].length;
			const text = match[2].trim();
			const id = text
				.toLowerCase()
				.replace(/[^\w\s-]/g, "")
				.replace(/\s+/g, "-");

			headings.push({
				id,
				level,
				text,
				offset,
			});
		}
		offset += line.length + 1; // +1 for newline
	}

	return headings;
}

/**
 * Extract tags from content (frontmatter or content analysis)
 */
function extractTags(text: string, filePath: string): string[] {
	const tags: string[] = [];

	// Check file path for hints
	const pathLower = filePath.toLowerCase();
	if (pathLower.includes("react")) tags.push("react");
	if (pathLower.includes("vue")) tags.push("vue");
	if (pathLower.includes("logger")) tags.push("logger");
	if (pathLower.includes("persist")) tags.push("persistent");
	if (pathLower.includes("guide")) tags.push("guide");
	if (pathLower.includes("api")) tags.push("api");

	// Check content for keywords
	const contentLower = text.toLowerCase();
	if (contentLower.includes("atom(") || contentLower.includes("createatom")) tags.push("atom");
	if (contentLower.includes("map(") || contentLower.includes("createmap")) tags.push("map");
	if (contentLower.includes("computed(")) tags.push("computed");
	if (contentLower.includes("persistentatom") || contentLower.includes("persistentmap"))
		tags.push("persistent");

	// Default tag
	if (tags.length === 0) tags.push("core");

	return Array.from(new Set(tags));
}

/**
 * Extract title from content (first H1 or filename)
 */
function extractTitle(text: string, filePath: string): string {
	const firstH1 = text.match(/^#\s+(.+)$/m);
	if (firstH1) {
		return firstH1[1].trim();
	}

	// Fallback to filename
	return basename(filePath, ".md").replace(/-/g, " ");
}

/**
 * Extract summary from content (first paragraph after title)
 */
function extractSummary(text: string): string | undefined {
	// Skip frontmatter if exists
	let content = text.replace(/^---[\s\S]*?---\n/, "");

	// Skip first heading
	content = content.replace(/^#[^\n]*\n/, "");

	// Get first non-empty paragraph
	const paragraphs = content.split("\n\n");
	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```")) {
			return trimmed.slice(0, 200);
		}
	}

	return undefined;
}

/**
 * Split text into chunks by headings and max length
 */
function createChunks(page: DocPage, text: string, maxChunkLength: number): DocChunk[] {
	const chunks: DocChunk[] = [];
	const headings = page.headings;
	let chunkId = 0;

	// If no headings, create one chunk
	if (headings.length === 0) {
		const chunkText = text.slice(0, maxChunkLength);
		chunks.push({
			id: `${page.id}#chunk-${chunkId++}`,
			pageId: page.id,
			headingPath: [],
			text: chunkText,
			scoreHint: 1,
		});
		return chunks;
	}

	// Split by headings
	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		const nextHeading = headings[i + 1];
		const startOffset = heading.offset;
		const endOffset = nextHeading ? nextHeading.offset : text.length;

		let sectionText = text.slice(startOffset, endOffset);

		// Build heading path (H1 > H2 > H3...)
		const headingPath: string[] = [];
		for (let j = i; j >= 0; j--) {
			if (headings[j].level <= heading.level) {
				headingPath.unshift(headings[j].text);
				if (headings[j].level === 1) break;
			}
		}

		// Split long sections into multiple chunks
		while (sectionText.length > 0) {
			const chunkText = sectionText.slice(0, maxChunkLength);
			sectionText = sectionText.slice(maxChunkLength);

			chunks.push({
				id: `${page.id}#${heading.id}-${chunkId++}`,
				pageId: page.id,
				headingPath,
				text: chunkText,
				scoreHint: heading.level === 1 ? 1.5 : heading.level === 2 ? 1.2 : 1,
			});
		}
	}

	return chunks;
}

/**
 * Build index from source
 */
async function buildIndex(state: DocsRepositoryState): Promise<DocsIndex> {
	const files = await state.source.listFiles();
	const pages: DocPage[] = [];
	const chunks: DocChunk[] = [];

	for (const filePath of files) {
		try {
			const text = await state.source.readFile(filePath);

			// Create page ID from relative path
			const pageId = filePath
				.replace(/\.(md|mdx)$/, "")
				.replace(/[/\\]/g, "/")
				.toLowerCase();

			const headings = parseHeadings(text);
			const tags = extractTags(text, filePath);
			const title = extractTitle(text, filePath);
			const summary = extractSummary(text);

			const page: DocPage = {
				id: pageId,
				title,
				filePath,
				headings,
				tags,
				summary,
			};

			pages.push(page);

			// Create chunks
			const pageChunks = createChunks(page, text, state.options.maxChunkLength);
			chunks.push(...pageChunks);
		} catch {
			// Skip files that can't be read
			continue;
		}
	}

	return {
		pages,
		chunks,
		builtAt: Date.now(),
	};
}

/**
 * Simple search implementation (TF-IDF-like)
 */
function searchChunks(
	index: DocsIndex,
	query: string,
	options?: DocsSearchOptions,
): DocsSearchResult {
	const queryTerms = query
		.toLowerCase()
		.split(/\s+/)
		.filter(t => t.length > 2);

	let chunks = index.chunks;

	// Filter by tags if specified
	if (options?.tags && options.tags.length > 0) {
		const pageIds = new Set(
			index.pages.filter(p => options.tags!.some(tag => p.tags.includes(tag))).map(p => p.id),
		);
		chunks = chunks.filter(c => pageIds.has(c.pageId));
	}

	// Filter by pageIds if specified
	if (options?.pageIds && options.pageIds.length > 0) {
		chunks = chunks.filter(c => options.pageIds!.includes(c.pageId));
	}

	// Score chunks
	const hits: DocsSearchHit[] = [];

	for (const chunk of chunks) {
		const page = index.pages.find(p => p.id === chunk.pageId);
		if (!page) continue;

		const textLower = chunk.text.toLowerCase();
		const titleLower = page.title.toLowerCase();
		let score = 0;

		// Count term matches
		for (const term of queryTerms) {
			const textMatches = (textLower.match(new RegExp(term, "g")) || []).length;
			const titleMatches = (titleLower.match(new RegExp(term, "g")) || []).length;

			score += textMatches * 1;
			score += titleMatches * 3; // Title matches are more important
		}

		// Apply base score hint
		score *= chunk.scoreHint || 1;

		if (score > 0) {
			hits.push({
				chunk,
				page,
				score,
			});
		}
	}

	// Sort by score
	hits.sort((a, b) => b.score - a.score);

	// Apply limit
	const limit = options?.limit || 10;
	const limitedHits = hits.slice(0, limit);

	return {
		query,
		hits: limitedHits,
	};
}

/**
 * Create a docs repository
 */
export function createDocsRepository(
	source: DocsSource,
	options?: DocsIndexOptions,
): DocsRepository {
	const state: DocsRepositoryState = {
		source,
		options: {
			maxChunkLength: options?.maxChunkLength || 1200,
			cacheTtlMs: options?.cacheTtlMs || 60_000 * 5, // 5 minutes
		},
		cachedIndex: null,
		lastBuildTime: 0,
	};

	return {
		async getIndex(): Promise<DocsIndex> {
			const now = Date.now();
			const isCacheValid =
				state.cachedIndex !== null && now - state.lastBuildTime < state.options.cacheTtlMs;

			if (isCacheValid) {
				return state.cachedIndex!;
			}

			// Build new index
			const index = await buildIndex(state);
			state.cachedIndex = index;
			state.lastBuildTime = now;

			return index;
		},

		async search(query: string, options?: DocsSearchOptions): Promise<DocsSearchResult> {
			const index = await this.getIndex();
			return searchChunks(index, query, options);
		},

		async getPageById(id: string): Promise<DocPage | undefined> {
			const index = await this.getIndex();
			return index.pages.find(p => p.id === id);
		},

		async getChunksByPageId(pageId: string): Promise<DocChunk[]> {
			const index = await this.getIndex();
			return index.chunks.filter(c => c.pageId === pageId);
		},
	};
}
