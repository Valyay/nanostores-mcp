import type { DocPage } from "../../domain/index.js";

export interface TagCount {
	tag: string;
	count: number;
}

export function aggregateTags(pages: DocPage[]): TagCount[] {
	const tagCounts = new Map<string, number>();
	for (const page of pages) {
		for (const tag of page.tags) {
			tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
		}
	}

	return Array.from(tagCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([tag, count]) => ({ tag, count }));
}
