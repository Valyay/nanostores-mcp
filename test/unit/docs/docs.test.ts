import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
	createDocsRepository,
	createDocsService,
	createFsDocsSource,
} from "../../../src/domain/index.ts";
import { createDocsFixture } from "../../helpers/fixtures.ts";

let docsRoot = "";

beforeAll(async () => {
	docsRoot = await createDocsFixture();
});

afterAll(async () => {
	if (docsRoot) {
		await fs.rm(docsRoot, { recursive: true, force: true });
	}
});

describe("docs domain: repository and service", () => {
	it("indexes pages and chunks from the filesystem", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });

		const index = await repository.getIndex();
		expect(index.pages.length).toBeGreaterThanOrEqual(3);
		expect(index.chunks.length).toBeGreaterThanOrEqual(index.pages.length);
		expect(index.builtAt).toBeGreaterThan(0);
	});

	it("supports search, page lookup, and tag-based discovery", async () => {
		const source = createFsDocsSource({ rootDir: docsRoot });
		const repository = createDocsRepository(source, { maxChunkLength: 200 });
		const service = createDocsService(repository);

		const search = await repository.search("atom");
		expect(search.hits.length).toBeGreaterThan(0);
		expect(search.hits.some(hit => hit.page.title.toLowerCase().includes("atom"))).toBe(true);

		const atomPage = search.hits[0].page;
		const page = await repository.getPageById(atomPage.id);
		expect(page?.title).toBe(atomPage.title);

		const chunks = await repository.getChunksByPageId(atomPage.id);
		expect(chunks.length).toBeGreaterThan(0);

		const persistentPages = await service.findForStore("persistentAtom");
		expect(persistentPages.some(pageItem => pageItem.tags.includes("persistent"))).toBe(true);

		const tags = await service.getTags();
		expect(tags).toContain("atom");
		expect(tags).toContain("persistent");
		expect(tags).toContain("logger");
	});
});
