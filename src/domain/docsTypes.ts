/**
 * Types for Nanostores documentation integration
 */

export interface DocPage {
	id: string; // stable id (e.g., "guide/atom")
	title: string;
	url?: string; // official URL (nanostores.org/...)
	filePath: string; // absolute path in FS
	headings: DocHeading[];
	tags: string[]; // ["core", "react", "logger", "persistent"]
	summary?: string; // extract from intro
}

export interface DocHeading {
	id: string; // anchor
	level: number; // 1-6
	text: string;
	offset: number; // position in file
}

export interface DocChunk {
	id: string;
	pageId: string;
	headingPath: string[]; // chain H1→H2→...
	text: string; // chunk with size splitting
	scoreHint?: number; // base weight (e.g., section importance)
}

export interface DocsIndex {
	pages: DocPage[];
	chunks: DocChunk[];
	builtAt: number;
}

export interface DocsSearchOptions {
	limit?: number;
	tags?: string[];
	pageIds?: string[];
}

export interface DocsSearchHit {
	chunk: DocChunk;
	page: DocPage;
	score: number;
}

export interface DocsSearchResult {
	query: string;
	hits: DocsSearchHit[];
}
