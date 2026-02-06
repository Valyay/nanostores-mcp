import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import {
	buildGraphOutline,
	buildIdDictionary,
	buildStoreGraph,
	buildStoreSubgraph,
	collectStoreNeighbors,
	createProjectAnalysisService,
	resolveStore,
} from "../../../src/domain/index.ts";
import { toPosix } from "../../helpers/fixtures.ts";

const storeCount = "store:src/stores/counter.ts#$count";
const storeCart = "store:src/stores/cart.ts#$cart";
const storeTotal = "store:src/stores/total.ts#$total";
const storeLegacyCount = "store:legacy/count.ts#$count";
const subscriberCounter = "subscriber:src/components/Counter.tsx#Counter";
const subscriberUseCart = "subscriber:src/hooks/useCart.ts#useCart";

const projectIndex: ProjectIndex = {
	rootDir: "/workspace",
	filesScanned: 6,
	stores: [
		{
			id: storeCount,
			file: "src/stores/counter.ts",
			line: 3,
			kind: "atom",
			name: "$count",
		},
		{
			id: storeCart,
			file: "src/stores/cart.ts",
			line: 2,
			kind: "map",
			name: "$cart",
		},
		{
			id: storeTotal,
			file: "src/stores/total.ts",
			line: 5,
			kind: "computed",
			name: "$total",
		},
		{
			id: storeLegacyCount,
			file: "legacy/count.ts",
			line: 1,
			kind: "atom",
			name: "$count",
		},
	],
	subscribers: [
		{
			id: subscriberCounter,
			file: "src/components/Counter.tsx",
			line: 6,
			kind: "component",
			name: "Counter",
			storeIds: [storeCount, storeTotal],
		},
		{
			id: subscriberUseCart,
			file: "src/hooks/useCart.ts",
			line: 3,
			kind: "hook",
			name: "useCart",
			storeIds: [storeCart],
		},
	],
	relations: [
		{
			type: "declares",
			from: "file:src/stores/counter.ts",
			to: storeCount,
			file: "src/stores/counter.ts",
			line: 3,
		},
		{
			type: "declares",
			from: "file:src/stores/cart.ts",
			to: storeCart,
			file: "src/stores/cart.ts",
			line: 2,
		},
		{
			type: "declares",
			from: "file:src/stores/total.ts",
			to: storeTotal,
			file: "src/stores/total.ts",
			line: 5,
		},
		{
			type: "declares",
			from: "file:legacy/count.ts",
			to: storeLegacyCount,
			file: "legacy/count.ts",
			line: 1,
		},
		{
			type: "declares",
			from: "file:src/components/Counter.tsx",
			to: subscriberCounter,
			file: "src/components/Counter.tsx",
			line: 6,
		},
		{
			type: "declares",
			from: "file:src/hooks/useCart.ts",
			to: subscriberUseCart,
			file: "src/hooks/useCart.ts",
			line: 3,
		},
		{
			type: "subscribes_to",
			from: subscriberCounter,
			to: storeCount,
			file: "src/components/Counter.tsx",
			line: 6,
		},
		{
			type: "subscribes_to",
			from: subscriberCounter,
			to: storeTotal,
			file: "src/components/Counter.tsx",
			line: 7,
		},
		{
			type: "subscribes_to",
			from: subscriberUseCart,
			to: storeCart,
			file: "src/hooks/useCart.ts",
			line: 3,
		},
		{
			type: "derives_from",
			from: storeTotal,
			to: storeCount,
			file: "src/stores/total.ts",
			line: 5,
		},
	],
};

describe("project domain: store lookup and neighbors", () => {
	it("resolves stores by id, name, and id tail with optional file hint", () => {
		const byId = resolveStore(projectIndex, storeTotal);
		expect(byId?.store.id).toBe(storeTotal);
		expect(byId?.by).toBe("id");

		const byName = resolveStore(projectIndex, "$cart");
		expect(byName?.store.id).toBe(storeCart);
		expect(byName?.by).toBe("name");

		const byTail = resolveStore(projectIndex, "count");
		expect(byTail?.store.name).toBe("$count");
		expect(byTail?.by).toBe("name");

		const byFile = resolveStore(projectIndex, "$count", { file: "legacy/count.ts" });
		expect(byFile?.store.id).toBe(storeLegacyCount);
	});

	it("collects subscribers and dependency relations for a store", () => {
		const countStore = projectIndex.stores.find(store => store.id === storeCount);
		expect(countStore).toBeTruthy();

		const neighbors = collectStoreNeighbors(projectIndex, countStore!);
		expect(neighbors.subscribers.some(sub => sub.id === subscriberCounter)).toBe(true);
		expect(neighbors.dependentsStores.some(store => store.id === storeTotal)).toBe(true);
		expect(neighbors.derivesFromStores.length).toBe(0);
	});
});

describe("project domain: graph and summary builders", () => {
	it("builds store graph with nodes, edges, and stats", () => {
		const graph = buildStoreGraph(projectIndex);

		expect(graph.stats.totalStores).toBe(projectIndex.stores.length);
		expect(graph.stats.subscribers).toBe(projectIndex.subscribers.length);
		expect(graph.stats.edgesByType.declares).toBeGreaterThan(0);
		expect(graph.stats.edgesByType.subscribes_to).toBe(3);
		expect(graph.stats.edgesByType.derives_from).toBe(1);
		expect(graph.nodes.some(node => node.type === "file")).toBe(true);
		expect(graph.hotStores.some(store => store.storeId === storeCount)).toBe(true);
	});

	it("builds outline, id dictionary, and store subgraph summaries", () => {
		const outline = buildGraphOutline(projectIndex);
		expect(outline.totals.stores).toBe(projectIndex.stores.length);
		expect(outline.storeKinds.atom).toBe(2);
		expect(outline.storeKinds.map).toBe(1);
		expect(outline.storeKinds.computed).toBe(1);
		const topDirs = outline.topDirs.map(dir => toPosix(dir.dir));
		expect(topDirs).toContain("src/stores");
		expect(topDirs).toContain("legacy");

		const dictionary = buildIdDictionary(projectIndex);
		expect(dictionary.version).toBe(1);
		expect(dictionary.stores.length).toBe(projectIndex.stores.length);
		expect(
			dictionary.files.some(file => toPosix(file.path) === "src/components/Counter.tsx"),
		).toBe(true);

		const totalStore = projectIndex.stores.find(store => store.id === storeTotal);
		const subgraph = buildStoreSubgraph(projectIndex, totalStore!, 1);
		const storeIds = subgraph.nodes
			.filter(node => node.type === "store")
			.map(node => node.id);

		expect(storeIds).toContain(storeTotal);
		expect(storeIds).toContain(storeCount);
		expect(subgraph.edges.some(edge => edge.type === "derives_from")).toBe(true);
	});
});

describe("project domain: project analysis service", () => {
	it("exposes store names and runtime key resolution", async () => {
		const repository = {
			getIndex: async (_root: string) => projectIndex,
			clearCache: (_root?: string) => {},
		};
		const service = createProjectAnalysisService(repository);

		const storeNames = await service.getStoreNames("/workspace");
		expect(storeNames).toEqual(["$cart", "$count", "$total"]);

		const byRuntimeName = await service.findStoreByRuntimeKey("/workspace", "count");
		expect(byRuntimeName?.id).toBe(storeCount);

		const byRuntimeNameWithDollar = await service.findStoreByRuntimeKey("/workspace", "$cart");
		expect(byRuntimeNameWithDollar?.id).toBe(storeCart);
	});
});
