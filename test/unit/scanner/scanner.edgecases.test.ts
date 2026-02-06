import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { buildStoreGraph, scanProject } from "../../../src/domain/index.ts";
import {
	NANOSTORES_BASE_MODULES,
	NANOSTORES_PERSISTENT_MODULES,
	NANOSTORES_FRAMEWORKS_MODULES,
} from "../../../src/domain/project/scanner/index.ts";
import { findStore, findSubscriber } from "../../helpers/assertIndex.ts";
import { createScannerEdgeCasesFixture, toPosix } from "../../helpers/fixtures.ts";

let projectRoot = "";
const extraBaseModules = ["../compat/nanostores"];
const extraPersistentModules = ["../compat/persistent"];
const extraFrameworkModules = ["../compat/react"];

beforeAll(async () => {
	for (const moduleName of extraBaseModules) {
		NANOSTORES_BASE_MODULES.add(moduleName);
	}
	for (const moduleName of extraPersistentModules) {
		NANOSTORES_PERSISTENT_MODULES.add(moduleName);
	}
	for (const moduleName of extraFrameworkModules) {
		NANOSTORES_FRAMEWORKS_MODULES.add(moduleName);
	}
	projectRoot = await createScannerEdgeCasesFixture();
});

afterAll(async () => {
	for (const moduleName of extraBaseModules) {
		NANOSTORES_BASE_MODULES.delete(moduleName);
	}
	for (const moduleName of extraPersistentModules) {
		NANOSTORES_PERSISTENT_MODULES.delete(moduleName);
	}
	for (const moduleName of extraFrameworkModules) {
		NANOSTORES_FRAMEWORKS_MODULES.delete(moduleName);
	}
	if (projectRoot) {
		await fs.rm(projectRoot, { recursive: true, force: true });
	}
});

describe("scanner domain: edge cases", () => {
	it("detects alias/namespace store factories and derived dependencies", async () => {
		const index = await scanProject(projectRoot);

		const aliasStore = findStore(index, "$alias", "stores/aliases.ts");
		const duplicateAliasStore = findStore(index, "$alias", "stores/duplicates.ts");
		const mapStore = findStore(index, "$map", "stores/aliases.ts");
		const nsMapStore = findStore(index, "$nsMap", "stores/aliases.ts");
		const persistStore = findStore(index, "$persist", "stores/aliases.ts");
		const familyStore = findStore(index, "$family", "stores/aliases.ts");
		const templateStore = findStore(index, "$template", "stores/aliases.ts");
		const computedStore = findStore(index, "$computed", "stores/aliases.ts");
		const computedArrayStore = findStore(index, "$computedArray", "stores/aliases.ts");
		const computedTplStore = findStore(index, "$computedTpl", "stores/aliases.ts");
		const computedNoDepsStore = findStore(index, "$computedNoDeps", "stores/aliases.ts");

		expect(aliasStore).toBeTruthy();
		expect(duplicateAliasStore).toBeTruthy();
		expect(mapStore?.kind).toBe("map");
		expect(nsMapStore?.kind).toBe("map");
		expect(persistStore?.kind).toBe("persistentMap");
		expect(familyStore?.kind).toBe("atomFamily");
		expect(templateStore?.kind).toBe("mapTemplate");
		expect(computedStore?.kind).toBe("computed");
		expect(computedArrayStore?.kind).toBe("computed");
		expect(computedTplStore?.kind).toBe("computedTemplate");
		expect(computedNoDepsStore?.kind).toBe("computed");

		const derivedEdges = index.relations.filter(rel => rel.type === "derives_from");

		expect(
			derivedEdges.some(rel => rel.from === computedStore!.id && rel.to === aliasStore!.id),
		).toBe(true);
		expect(
			derivedEdges.some(rel => rel.from === computedTplStore!.id && rel.to === aliasStore!.id),
		).toBe(true);
		expect(
			derivedEdges.some(rel => rel.from === computedArrayStore!.id && rel.to === aliasStore!.id),
		).toBe(true);
		expect(
			derivedEdges.some(rel => rel.from === computedArrayStore!.id && rel.to === nsMapStore!.id),
		).toBe(true);

		const arrayAliasEdges = derivedEdges.filter(
			rel => rel.from === computedArrayStore!.id && rel.to === aliasStore!.id,
		);
		expect(arrayAliasEdges.length).toBe(1);

		expect(derivedEdges.some(rel => rel.from === computedNoDepsStore!.id)).toBe(false);
	});

	it("detects subscribers across containers and ignores invalid useStore calls", async () => {
		const index = await scanProject(projectRoot);

		const aliasStore = findStore(index, "$alias", "stores/aliases.ts");
		const nsMapStore = findStore(index, "$nsMap", "stores/aliases.ts");
		const persistStore = findStore(index, "$persist", "stores/aliases.ts");
		const computedStore = findStore(index, "$computed", "stores/aliases.ts");

		const aliasComponent = findSubscriber(index, "AliasComponent");
		const useDashboard = findSubscriber(index, "useDashboard");
		const classCounter = findSubscriber(index, "ClassCounter.render");
		const cartEffect = findSubscriber(index, "cartEffect");
		const anonSubscriber = findSubscriber(index, "Anon");

		expect(aliasComponent?.kind).toBe("component");
		expect(aliasComponent?.storeIds).toContain(aliasStore!.id);
		expect(aliasComponent?.storeIds).toContain(nsMapStore!.id);
		expect(aliasComponent?.storeIds).toContain(persistStore!.id);
		expect(aliasComponent?.storeIds).toContain(computedStore!.id);

		expect(useDashboard?.kind).toBe("hook");
		expect(useDashboard?.storeIds).toContain(aliasStore!.id);

		expect(classCounter?.kind).toBe("component");
		expect(classCounter?.storeIds).toContain(aliasStore!.id);

		expect(cartEffect?.kind).toBe("effect");
		expect(cartEffect?.storeIds).toContain(aliasStore!.id);

		expect(anonSubscriber?.kind).toBe("component");
		expect(anonSubscriber?.storeIds).toContain(aliasStore!.id);
		expect(toPosix(anonSubscriber?.id ?? "")).toMatch(/^subscriber:components\/Anon\.tsx@/);

		expect(index.subscribers.some(sub => sub.name === "IgnoreArgs")).toBe(false);
		expect(index.subscribers.some(sub => sub.name === "Ambiguous")).toBe(false);
	});

	it("supports compat re-exports and namespace imports for stores and subscribers", async () => {
		const index = await scanProject(projectRoot);

		const compatAtom = findStore(index, "$compatAtom", "stores/compat.ts");
		const compatNsMap = findStore(index, "$compatNsMap", "stores/compat.ts");
		const compatPersistent = findStore(index, "$compatPersistent", "stores/compat.ts");
		const compatComputed = findStore(index, "$compatComputed", "stores/compat.ts");

		expect(compatAtom?.kind).toBe("atom");
		expect(compatNsMap?.kind).toBe("map");
		expect(compatPersistent?.kind).toBe("persistentAtom");
		expect(compatComputed?.kind).toBe("computed");

		const derivedEdge = index.relations.find(
			rel => rel.type === "derives_from" && rel.from === compatComputed!.id && rel.to === compatAtom!.id,
		);
		expect(derivedEdge?.file).toBe("stores/compat.ts");
		expect(derivedEdge?.line).toBe(compatComputed?.line);

		const compatComponent = findSubscriber(index, "CompatComponent");
		expect(compatComponent?.kind).toBe("component");
		expect(compatComponent?.storeIds).toContain(compatAtom!.id);
		expect(compatComponent?.storeIds).toContain(compatComputed!.id);
	});

	it("covers framework adapters for useStore across supported imports", async () => {
		const index = await scanProject(projectRoot);

		const frameworkStore = findStore(index, "$framework", "stores/framework.ts");
		expect(frameworkStore?.kind).toBe("atom");

		const reactUnscoped = findSubscriber(index, "ReactUnscoped");
		const reactScoped = findSubscriber(index, "ReactScoped");
		const preactWidget = findSubscriber(index, "PreactWidget");
		const solidWidget = findSubscriber(index, "SolidWidget");

		expect(reactUnscoped?.kind).toBe("component");
		expect(reactUnscoped?.storeIds).toContain(frameworkStore!.id);

		expect(reactScoped?.kind).toBe("component");
		expect(reactScoped?.storeIds).toContain(frameworkStore!.id);

		expect(preactWidget?.kind).toBe("component");
		expect(preactWidget?.storeIds).toContain(frameworkStore!.id);

		expect(solidWidget?.kind).toBe("component");
		expect(solidWidget?.storeIds).toContain(frameworkStore!.id);
	});

	it("detects nanostores usage in .vue and .svelte single-file components", async () => {
		const index = await scanProject(projectRoot);

		const frameworkStore = findStore(index, "$framework", "stores/framework.ts");
		expect(frameworkStore?.kind).toBe("atom");

		const vueSubscriber = findSubscriber(index, "VueWidget");
		const svelteSubscriber = findSubscriber(index, "SvelteWidget");

		expect(vueSubscriber?.file).toBe("components/VueWidget.vue");
		expect(vueSubscriber?.storeIds).toContain(frameworkStore!.id);

		expect(svelteSubscriber?.file).toBe("components/SvelteWidget.svelte");
		expect(svelteSubscriber?.storeIds).toContain(frameworkStore!.id);
	});

	it("builds graph stats based on scanned dependencies", async () => {
		const index = await scanProject(projectRoot);
		const graph = buildStoreGraph(index);

		const aliasStore = findStore(index, "$alias", "stores/aliases.ts");
		const aliasHot = graph.hotStores.find(store => store.storeId === aliasStore!.id);

		expect(aliasHot?.subscribers).toBe(5);
		expect(aliasHot?.derivedDependents).toBe(3);
		expect(aliasHot?.totalDegree).toBe(8);

		const fileNodeIds = graph.nodes.filter(node => node.type === "file").map(node => toPosix(node.id));
		expect(fileNodeIds).toContain("file:stores/aliases.ts");
		expect(fileNodeIds).toContain("file:components/AliasComponent.tsx");
	});

	it("includes strict edge metadata and stable ids in graph output", async () => {
		const index = await scanProject(projectRoot);
		const graph = buildStoreGraph(index);

		const aliasStore = findStore(index, "$alias", "stores/aliases.ts");
		const computedStore = findStore(index, "$computed", "stores/aliases.ts");
		const aliasComponent = findSubscriber(index, "AliasComponent");

		expect(aliasStore?.id).toBe(`store:${aliasStore?.file}#${aliasStore?.name}`);
		expect(aliasComponent?.id).toBe(`subscriber:${aliasComponent?.file}#${aliasComponent?.name}`);

		const declaresStore = index.relations.find(
			rel => rel.type === "declares" && rel.to === aliasStore!.id,
		);
		expect(declaresStore?.from).toBe(`file:${aliasStore?.file}`);
		expect(declaresStore?.file).toBe(aliasStore?.file);
		expect(declaresStore?.line).toBe(aliasStore?.line);

		const subscribes = index.relations.find(
			rel =>
				rel.type === "subscribes_to" &&
				rel.from === aliasComponent!.id &&
				rel.to === aliasStore!.id,
		);
		expect(subscribes?.file).toBe(aliasComponent?.file);
		expect(subscribes?.line).toBe(aliasComponent?.line);

		const derives = index.relations.find(
			rel => rel.type === "derives_from" && rel.from === computedStore!.id && rel.to === aliasStore!.id,
		);
		expect(derives?.file).toBe(computedStore?.file);
		expect(derives?.line).toBe(computedStore?.line);

		const graphEdge = graph.edges.find(
			edge =>
				edge.type === "subscribes_to" &&
				edge.from === aliasComponent!.id &&
				edge.to === aliasStore!.id,
		);
		expect(graphEdge?.file).toBe(aliasComponent?.file);
		expect(graphEdge?.line).toBe(aliasComponent?.line);
	});
});
