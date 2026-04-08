import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import {
	buildGraphOutline,
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
	mutators: [],
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

	it("resolves by id tail when name lookup fails", () => {
		// Use a raw key that doesn't match any name but matches an id tail
		const result = resolveStore(projectIndex, "$total");
		expect(result?.store.id).toBe(storeTotal);
		// Should be "name" since $total is a name match
		expect(result?.by).toBe("name");
	});

	it("resolves by id tail fallback when store: prefix id is not found", () => {
		// Malformed store: prefix — the full id doesn't match, but the tail after # does
		const result = resolveStore(projectIndex, "store:wrong/path.ts#$cart");
		expect(result?.store.id).toBe(storeCart);
		expect(result?.by).toBe("id_tail");
		expect(result?.requested).toBe("store:wrong/path.ts#$cart");
	});

	it("returns null for completely unknown store: prefix id", () => {
		const result = resolveStore(projectIndex, "store:no/such/file.ts#$nope");
		expect(result).toBeNull();
	});

	it("returns null for unknown name", () => {
		const result = resolveStore(projectIndex, "$nonexistent");
		expect(result).toBeNull();
	});

	it("falls back to id_tail when file filter eliminates all name matches", () => {
		const result = resolveStore(projectIndex, "$count", { file: "no/such/file.ts" });
		// $count exists in 2 files, but neither matches the file filter
		// Name resolution returns null → falls back to id_tail (which ignores file filter)
		expect(result?.by).toBe("id_tail");
		expect(result?.store.name).toBe("$count");
	});

	it("reports multiple matches with note about other files", () => {
		// $count exists in src/stores/counter.ts and legacy/count.ts
		const result = resolveStore(projectIndex, "$count");
		expect(result?.by).toBe("name");
		expect(result?.note).toContain("multiple matches");
	});

	it("collects subscribers and dependency relations for a store", () => {
		const countStore = projectIndex.stores.find(store => store.id === storeCount);
		expect(countStore).toBeTruthy();

		const neighbors = collectStoreNeighbors(projectIndex, countStore!);
		expect(neighbors.subscribers.some(sub => sub.id === subscriberCounter)).toBe(true);
		expect(neighbors.dependentsStores.some(store => store.id === storeTotal)).toBe(true);
		expect(neighbors.derivesFromStores.length).toBe(0);
	});

	it("collects derivesFrom for computed stores", () => {
		const totalStore = projectIndex.stores.find(store => store.id === storeTotal);
		expect(totalStore).toBeTruthy();

		const neighbors = collectStoreNeighbors(projectIndex, totalStore!);
		expect(neighbors.derivesFromStores).toHaveLength(1);
		expect(neighbors.derivesFromStores[0].id).toBe(storeCount);
		expect(neighbors.derivesFromEdges).toHaveLength(1);
		expect(neighbors.derivesFromEdges[0].type).toBe("derives_from");
	});

	it("returns empty neighbors for isolated store", () => {
		const cartStore = projectIndex.stores.find(store => store.id === storeCart);
		expect(cartStore).toBeTruthy();

		const neighbors = collectStoreNeighbors(projectIndex, cartStore!);
		// $cart has a subscriber (useCart) but no derives_from/dependents
		expect(neighbors.subscribers).toHaveLength(1);
		expect(neighbors.derivesFromStores).toHaveLength(0);
		expect(neighbors.dependentsStores).toHaveLength(0);
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

		const totalStore = projectIndex.stores.find(store => store.id === storeTotal);
		const subgraph = buildStoreSubgraph(projectIndex, totalStore!, 1);
		const storeIds = subgraph.nodes.filter(node => node.type === "store").map(node => node.id);

		expect(storeIds).toContain(storeTotal);
		expect(storeIds).toContain(storeCount);
		expect(subgraph.edges.some(edge => edge.type === "derives_from")).toBe(true);
	});

	it("unreferencedStores: stores with no subscribers or derived dependents are reported", () => {
		const outline = buildGraphOutline(projectIndex);
		const unreferencedIds = outline.unreferencedStores.map(s => s.storeId);

		// $legacyCount has only a declares edge — nobody subscribes to or derives from it
		expect(unreferencedIds).toContain(storeLegacyCount);

		// $count, $cart, $total all have subscribes_to or derives_from edges
		expect(unreferencedIds).not.toContain(storeCount);
		expect(unreferencedIds).not.toContain(storeCart);
		expect(unreferencedIds).not.toContain(storeTotal);
	});

	it("unreferencedStores: provides raw quantitative signals, not qualitative categories", () => {
		const outline = buildGraphOutline(projectIndex);
		const legacy = outline.unreferencedStores.find(s => s.storeId === storeLegacyCount);

		expect(legacy).toBeTruthy();
		// Raw signals — LLM interprets these
		expect(legacy!.mutatorCount).toBe(0);
		expect(legacy!.sfcFileReferences).toBe(0);
		expect(legacy!.isPersistent).toBe(false);
		// No category or reason — that's the LLM's job
		expect(legacy).not.toHaveProperty("category");
		expect(legacy).not.toHaveProperty("reason");
	});

	it("unreferencedStores: mutatorCount reflects write-only pattern", () => {
		const writeOnlyStore = "store:src/stores/writeOnly.ts#$writeOnly";
		const mutatorId = "mutator:src/actions/update.ts#updateAction";
		const woIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 3,
			stores: [
				{ id: writeOnlyStore, file: "src/stores/writeOnly.ts", line: 1, kind: "atom", name: "$writeOnly" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 6, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [
				{ id: mutatorId, file: "src/actions/update.ts", line: 5, kind: "action", name: "updateAction", storeIds: [writeOnlyStore] },
			],
			relations: [
				{ type: "declares", from: "file:src/stores/writeOnly.ts", to: writeOnlyStore, file: "src/stores/writeOnly.ts", line: 1 },
				{ type: "declares", from: "file:src/stores/counter.ts", to: storeCount, file: "src/stores/counter.ts", line: 1 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 6 },
				{ type: "mutates", from: mutatorId, to: writeOnlyStore, file: "src/actions/update.ts", line: 5 },
			],
		};
		const outline = buildGraphOutline(woIndex);
		const wo = outline.unreferencedStores.find(s => s.storeId === writeOnlyStore);
		expect(wo?.mutatorCount).toBe(1);
	});

	it("unreferencedStores: sfcFileReferences reflects SFC file consumption signal", () => {
		const svelteStore = "store:src/stores/page.ts#$page";
		const ftIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 2,
			stores: [
				{ id: svelteStore, file: "src/stores/page.ts", line: 1, kind: "atom", name: "$page" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 6, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [],
			relations: [
				{ type: "declares", from: "file:src/stores/page.ts", to: svelteStore, file: "src/stores/page.ts", line: 1 },
				{ type: "declares", from: "file:src/stores/counter.ts", to: storeCount, file: "src/stores/counter.ts", line: 1 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 6 },
				{ type: "declares", from: "file:components/Page.svelte", to: svelteStore, file: "components/Page.svelte", line: 3 },
			],
		};
		const outline = buildGraphOutline(ftIndex);
		const page = outline.unreferencedStores.find(s => s.storeId === svelteStore);
		expect(page?.sfcFileReferences).toBe(1);
	});

	it("unreferencedStores: isPersistent reflects persistent store kind", () => {
		const persistentStore = "store:src/stores/prefs.ts#$prefs";
		const pIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 2,
			stores: [
				{ id: persistentStore, file: "src/stores/prefs.ts", line: 1, kind: "persistentAtom", name: "$prefs" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 6, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [],
			relations: [
				{ type: "declares", from: "file:src/stores/prefs.ts", to: persistentStore, file: "src/stores/prefs.ts", line: 1 },
				{ type: "declares", from: "file:src/stores/counter.ts", to: storeCount, file: "src/stores/counter.ts", line: 1 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 6 },
			],
		};
		const outline = buildGraphOutline(pIndex);
		const prefs = outline.unreferencedStores.find(s => s.storeId === persistentStore);
		expect(prefs?.isPersistent).toBe(true);
	});

	it("unreferencedStores: empty when project has no subscriber or derived edges", () => {
		const declaresOnlyIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 1,
			stores: [{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" }],
			subscribers: [],
			mutators: [],
			relations: [{ type: "declares", from: "file:src/stores/counter.ts", to: storeCount, file: "src/stores/counter.ts", line: 1 }],
		};
		const outline = buildGraphOutline(declaresOnlyIndex);
		expect(outline.unreferencedStores).toEqual([]);
	});

	it("coOccurringPairs: two stores appearing together in a subscriber are a pair", () => {
		const storeA = "store:src/a.ts#$a";
		const storeB = "store:src/b.ts#$b";
		const pairIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 3,
			stores: [
				{ id: storeA, file: "src/a.ts", line: 1, kind: "atom", name: "$a" },
				{ id: storeB, file: "src/b.ts", line: 1, kind: "atom", name: "$b" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				{ id: "subscriber:src/App.tsx#App", file: "src/App.tsx", line: 1, kind: "component", name: "App", storeIds: [storeA, storeB] },
				// $count has no co-subscriber partner
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 1, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [],
			relations: [
				{ type: "subscribes_to", from: "subscriber:src/App.tsx#App", to: storeA, file: "src/App.tsx", line: 1 },
				{ type: "subscribes_to", from: "subscriber:src/App.tsx#App", to: storeB, file: "src/App.tsx", line: 1 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 1 },
			],
		};
		const outline = buildGraphOutline(pairIndex);
		expect(outline.coOccurringPairs).toHaveLength(1);
		const pair = outline.coOccurringPairs[0];
		expect([pair.storeIdA, pair.storeIdB]).toContain(storeA);
		expect([pair.storeIdA, pair.storeIdB]).toContain(storeB);
		expect(pair.count).toBe(1);
	});

	it("coOccurringPairs: count increments when the same pair appears in multiple subscribers", () => {
		const storeA = "store:src/a.ts#$a";
		const storeB = "store:src/b.ts#$b";
		const sub1 = "subscriber:src/Comp1.tsx#Comp1";
		const sub2 = "subscriber:src/Comp2.tsx#Comp2";
		const pairIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 3,
			stores: [
				{ id: storeA, file: "src/a.ts", line: 1, kind: "atom", name: "$a" },
				{ id: storeB, file: "src/b.ts", line: 1, kind: "atom", name: "$b" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				{ id: sub1, file: "src/Comp1.tsx", line: 1, kind: "component", name: "Comp1", storeIds: [storeA, storeB] },
				{ id: sub2, file: "src/Comp2.tsx", line: 1, kind: "component", name: "Comp2", storeIds: [storeA, storeB, storeCount] },
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 1, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [],
			relations: [
				{ type: "subscribes_to", from: sub1, to: storeA, file: "src/Comp1.tsx", line: 1 },
				{ type: "subscribes_to", from: sub1, to: storeB, file: "src/Comp1.tsx", line: 1 },
				{ type: "subscribes_to", from: sub2, to: storeA, file: "src/Comp2.tsx", line: 1 },
				{ type: "subscribes_to", from: sub2, to: storeB, file: "src/Comp2.tsx", line: 1 },
				{ type: "subscribes_to", from: sub2, to: storeCount, file: "src/Comp2.tsx", line: 1 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 1 },
			],
		};
		const outline = buildGraphOutline(pairIndex);
		const abPair = outline.coOccurringPairs.find(
			p => [p.storeIdA, p.storeIdB].includes(storeA) && [p.storeIdA, p.storeIdB].includes(storeB),
		);
		expect(abPair?.count).toBe(2);
	});

	it("coOccurringPairs: sorted by count descending", () => {
		const storeA = "store:src/a.ts#$a";
		const storeB = "store:src/b.ts#$b";
		const storeC = "store:src/c.ts#$c";
		const sub1 = "subscriber:src/S1.tsx#S1";
		const sub2 = "subscriber:src/S2.tsx#S2";
		const sub3 = "subscriber:src/S3.tsx#S3";
		const sortIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 4,
			stores: [
				{ id: storeA, file: "src/a.ts", line: 1, kind: "atom", name: "$a" },
				{ id: storeB, file: "src/b.ts", line: 1, kind: "atom", name: "$b" },
				{ id: storeC, file: "src/c.ts", line: 1, kind: "atom", name: "$c" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				// A+B appear together twice; A+C once
				{ id: sub1, file: "src/S1.tsx", line: 1, kind: "component", name: "S1", storeIds: [storeA, storeB] },
				{ id: sub2, file: "src/S2.tsx", line: 1, kind: "component", name: "S2", storeIds: [storeA, storeB] },
				{ id: sub3, file: "src/S3.tsx", line: 1, kind: "component", name: "S3", storeIds: [storeA, storeC] },
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 1, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [],
			relations: [
				{ type: "subscribes_to", from: sub1, to: storeA, file: "src/S1.tsx", line: 1 },
				{ type: "subscribes_to", from: sub1, to: storeB, file: "src/S1.tsx", line: 1 },
				{ type: "subscribes_to", from: sub2, to: storeA, file: "src/S2.tsx", line: 1 },
				{ type: "subscribes_to", from: sub2, to: storeB, file: "src/S2.tsx", line: 1 },
				{ type: "subscribes_to", from: sub3, to: storeA, file: "src/S3.tsx", line: 1 },
				{ type: "subscribes_to", from: sub3, to: storeC, file: "src/S3.tsx", line: 1 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 1 },
			],
		};
		const outline = buildGraphOutline(sortIndex);
		expect(outline.coOccurringPairs[0].count).toBeGreaterThanOrEqual(outline.coOccurringPairs[1].count);
	});

	it("coOccurringPairs: empty when no subscriber has 2+ known stores", () => {
		const outline = buildGraphOutline({
			rootDir: "/workspace",
			filesScanned: 1,
			stores: [{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" }],
			subscribers: [
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 1, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [],
			relations: [{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 1 }],
		});
		expect(outline.coOccurringPairs).toEqual([]);
	});

	it("hubs: subscribersByKind shows breakdown of subscriber kinds", () => {
		const outline = buildGraphOutline(projectIndex);

		const countHub = outline.hubs.find(h => h.storeId === storeCount);
		expect(countHub).toBeTruthy();
		// Counter (component) subscribes to $count
		expect(countHub!.subscribersByKind).toEqual({ component: 1 });

		const cartHub = outline.hubs.find(h => h.storeId === storeCart);
		expect(cartHub).toBeTruthy();
		// useCart (hook) subscribes to $cart
		expect(cartHub!.subscribersByKind).toEqual({ hook: 1 });
	});

	it("hubs: mutatorsByKind shows breakdown of mutator kinds", () => {
		const actionId = "mutator:src/actions/reset.ts#resetCounter";
		const mutatedIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 3,
			stores: [
				{ id: storeCount, file: "src/stores/counter.ts", line: 3, kind: "atom", name: "$count" },
				{ id: storeCart, file: "src/stores/cart.ts", line: 2, kind: "map", name: "$cart" },
			],
			subscribers: [
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 6, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [
				{ id: actionId, file: "src/actions/reset.ts", line: 3, kind: "action", name: "resetCounter", storeIds: [storeCount] },
			],
			relations: [
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 6 },
				{ type: "mutates", from: actionId, to: storeCount, file: "src/actions/reset.ts", line: 3 },
				{ type: "subscribes_to", from: subscriberCounter, to: storeCart, file: "src/components/Counter.tsx", line: 7 },
			],
		};
		const outline = buildGraphOutline(mutatedIndex);

		const countHub = outline.hubs.find(h => h.storeId === storeCount);
		expect(countHub).toBeTruthy();
		expect(countHub!.mutatorsByKind).toEqual({ action: 1 });

		const cartHub = outline.hubs.find(h => h.storeId === storeCart);
		expect(cartHub).toBeTruthy();
		// $cart has no mutators
		expect(cartHub!.mutatorsByKind).toEqual({});
	});

	it("unreferencedStores: mutatorsByKind shows breakdown of mutator kinds", () => {
		const writeOnlyStore = "store:src/stores/writeOnly.ts#$writeOnly";
		const actionId = "mutator:src/actions/update.ts#updateAction";
		const componentId = "mutator:src/components/Admin.tsx#handleReset";
		const woIndex: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 3,
			stores: [
				{ id: writeOnlyStore, file: "src/stores/writeOnly.ts", line: 1, kind: "atom", name: "$writeOnly" },
				{ id: storeCount, file: "src/stores/counter.ts", line: 1, kind: "atom", name: "$count" },
			],
			subscribers: [
				{ id: subscriberCounter, file: "src/components/Counter.tsx", line: 6, kind: "component", name: "Counter", storeIds: [storeCount] },
			],
			mutators: [
				{ id: actionId, file: "src/actions/update.ts", line: 5, kind: "action", name: "updateAction", storeIds: [writeOnlyStore] },
				{ id: componentId, file: "src/components/Admin.tsx", line: 12, kind: "component", name: "handleReset", storeIds: [writeOnlyStore] },
			],
			relations: [
				{ type: "subscribes_to", from: subscriberCounter, to: storeCount, file: "src/components/Counter.tsx", line: 6 },
				{ type: "mutates", from: actionId, to: writeOnlyStore, file: "src/actions/update.ts", line: 5 },
				{ type: "mutates", from: componentId, to: writeOnlyStore, file: "src/components/Admin.tsx", line: 12 },
			],
		};
		const outline = buildGraphOutline(woIndex);
		const wo = outline.unreferencedStores.find(s => s.storeId === writeOnlyStore);
		expect(wo).toBeTruthy();
		expect(wo!.mutatorsByKind).toEqual({ action: 1, component: 1 });
	});
});

describe("project domain: project analysis service", () => {
	const repository = {
		getIndex: async () => projectIndex,
		clearCache: () => {},
	};

	it("exposes store names and runtime key resolution", async () => {
		const service = createProjectAnalysisService(repository);

		const storeNames = await service.getStoreNames("/workspace");
		expect(storeNames).toEqual(["$cart", "$count", "$total"]);

		const byRuntimeName = await service.findStoreByRuntimeKey("/workspace", "count");
		expect(byRuntimeName?.id).toBe(storeCount);

		const byRuntimeNameWithDollar = await service.findStoreByRuntimeKey("/workspace", "$cart");
		expect(byRuntimeNameWithDollar?.id).toBe(storeCart);
	});

	it("getStoreNeighbors returns edges alongside stores", async () => {
		const service = createProjectAnalysisService(repository);
		const totalStore = projectIndex.stores.find(s => s.id === storeTotal)!;

		const neighbors = await service.getStoreNeighbors("/workspace", totalStore);

		expect(neighbors.derivesFrom).toHaveLength(1);
		expect(neighbors.derivesFrom[0].id).toBe(storeCount);
		expect(neighbors.derivesFromEdges).toHaveLength(1);
		expect(neighbors.derivesFromEdges[0].type).toBe("derives_from");
		expect(neighbors.derivesFromEdges[0].from).toBe(storeTotal);
		expect(neighbors.derivesFromEdges[0].to).toBe(storeCount);

		const countStore = projectIndex.stores.find(s => s.id === storeCount)!;
		const countNeighbors = await service.getStoreNeighbors("/workspace", countStore);

		expect(countNeighbors.dependents).toHaveLength(1);
		expect(countNeighbors.dependentsEdges).toHaveLength(1);
		expect(countNeighbors.dependentsEdges[0].from).toBe(storeTotal);
		expect(countNeighbors.dependentsEdges[0].to).toBe(storeCount);
	});

	it("resolveStoreByKey returns full resolution metadata", async () => {
		const service = createProjectAnalysisService(repository);

		const byId = await service.resolveStoreByKey("/workspace", storeTotal);
		expect(byId).not.toBeNull();
		expect(byId!.by).toBe("id");
		expect(byId!.store.id).toBe(storeTotal);

		const byName = await service.resolveStoreByKey("/workspace", "$cart");
		expect(byName).not.toBeNull();
		expect(byName!.by).toBe("name");
		expect(byName!.store.id).toBe(storeCart);

		const notFound = await service.resolveStoreByKey("/workspace", "$nonexistent");
		expect(notFound).toBeNull();
	});
});

describe("hubs: weighted score", () => {
	it("store with UI subscriber ranks above store with only derived dependent", () => {
		const storeA = "store:src/a.ts#$a"; // 1 subscriber → score = 3
		const storeC = "store:src/c.ts#$c"; // 1 derived dependent → score = 2
		const subA = "subscriber:src/App.tsx#App";
		const index: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 2,
			stores: [
				{ id: storeA, file: "src/a.ts", line: 1, kind: "atom", name: "$a" },
				{ id: storeC, file: "src/c.ts", line: 1, kind: "atom", name: "$c" },
			],
			subscribers: [{ id: subA, file: "src/App.tsx", line: 1, kind: "component", name: "App", storeIds: [storeA] }],
			mutators: [],
			relations: [
				{ type: "subscribes_to", from: subA, to: storeA, file: "src/App.tsx", line: 1 },
				// any store deriving from $c gives $c a derived dependent (score = 2)
				{ type: "derives_from", from: "store:src/d.ts#$d", to: storeC, file: "src/d.ts", line: 1 },
			],
		};

		const outline = buildGraphOutline(index);
		const hubA = outline.hubs.find(h => h.storeId === storeA);
		const hubC = outline.hubs.find(h => h.storeId === storeC);

		expect(hubA).toBeTruthy();
		expect(hubC).toBeTruthy();
		expect(hubA!.score).toBeGreaterThan(hubC!.score);

		const names = outline.hubs.map(h => h.storeId);
		expect(names.indexOf(storeA)).toBeLessThan(names.indexOf(storeC));
	});

	it("store with only declares edge does not appear in hubs", () => {
		const storeIsolated = "store:src/isolated.ts#$isolated";
		const storeActive = "store:src/active.ts#$active";
		const sub = "subscriber:src/App.tsx#App";
		const index: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 2,
			stores: [
				{ id: storeIsolated, file: "src/isolated.ts", line: 1, kind: "atom", name: "$isolated" },
				{ id: storeActive, file: "src/active.ts", line: 1, kind: "atom", name: "$active" },
			],
			subscribers: [{ id: sub, file: "src/App.tsx", line: 1, kind: "component", name: "App", storeIds: [storeActive] }],
			mutators: [],
			relations: [
				{ type: "declares", from: "file:src/isolated.ts", to: storeIsolated, file: "src/isolated.ts", line: 1 },
				{ type: "declares", from: "file:src/active.ts", to: storeActive, file: "src/active.ts", line: 1 },
				{ type: "subscribes_to", from: sub, to: storeActive, file: "src/App.tsx", line: 1 },
			],
		};

		const outline = buildGraphOutline(index);
		const hubIds = outline.hubs.map(h => h.storeId);

		expect(hubIds).not.toContain(storeIsolated);
		expect(hubIds).toContain(storeActive);
	});

	it("hub exposes mutators count alongside subscribers and derivedDependents", () => {
		const storeA = "store:src/a.ts#$a";
		const mutatorA = "mutator:src/actions.ts#setA";
		const index: ProjectIndex = {
			rootDir: "/workspace",
			filesScanned: 2,
			stores: [{ id: storeA, file: "src/a.ts", line: 1, kind: "atom", name: "$a" }],
			subscribers: [],
			mutators: [{ id: mutatorA, file: "src/actions.ts", line: 1, kind: "action", name: "setA", storeIds: [storeA] }],
			relations: [
				{ type: "declares", from: "file:src/a.ts", to: storeA, file: "src/a.ts", line: 1 },
				{ type: "mutates", from: mutatorA, to: storeA, file: "src/actions.ts", line: 1 },
			],
		};

		const outline = buildGraphOutline(index);
		const hub = outline.hubs.find(h => h.storeId === storeA);

		expect(hub).toBeTruthy();
		expect(hub!.mutators).toBe(1);
	});
});
