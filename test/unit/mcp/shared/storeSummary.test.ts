import { describe, expect, it } from "vitest";
import {
	buildStoreSummaryText,
	buildStoreStructuredContent,
} from "../../../../src/mcp/shared/storeSummary.ts";
import type {
	StoreMatch,
	StoreRelation,
	SubscriberMatch,
} from "../../../../src/domain/project/types.ts";

function makeStore(overrides: Partial<StoreMatch> = {}): StoreMatch {
	return {
		id: "store:src/stores.ts#$counter",
		file: "src/stores.ts",
		line: 5,
		kind: "atom",
		name: "$counter",
		...overrides,
	};
}

function makeSub(overrides: Partial<SubscriberMatch> = {}): SubscriberMatch {
	return {
		id: "subscriber:src/App.tsx#App",
		file: "src/App.tsx",
		line: 10,
		kind: "component",
		name: "App",
		storeIds: ["store:src/stores.ts#$counter"],
		...overrides,
	};
}

describe("buildStoreSummaryText", () => {
	it("renders a base store with no neighbors", () => {
		const text = buildStoreSummaryText({
			store: makeStore(),
			subscribers: [],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(text).toContain("Store: $counter");
		expect(text).toContain("Kind: atom");
		expect(text).toContain("File: src/stores.ts:5");
		expect(text).toContain("Derives from: none (base store)");
		expect(text).toContain("Derived dependents: none");
		expect(text).toContain("Subscribers: none found");
	});

	it("includes resolution info when provided", () => {
		const text = buildStoreSummaryText({
			store: makeStore(),
			resolutionBy: "name",
			resolutionRequested: "counter",
			resolutionNote: "Matched with $ prefix",
			subscribers: [],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(text).toContain("Resolved by: name (requested: counter)");
		expect(text).toContain("Matched with $ prefix");
	});

	it("lists subscribers, derives-from, and dependents", () => {
		const parentStore = makeStore({
			id: "store:src/base.ts#$base",
			name: "$base",
			file: "src/base.ts",
			line: 1,
			kind: "atom",
		});
		const dependentStore = makeStore({
			id: "store:src/derived2.ts#$derived2",
			name: "$derived2",
			file: "src/derived2.ts",
			line: 3,
			kind: "computed",
		});
		const computed = makeStore({
			kind: "computed",
			name: "$total",
			id: "store:src/stores.ts#$total",
		});
		const sub = makeSub();

		const text = buildStoreSummaryText({
			store: computed,
			subscribers: [sub],
			derivesFromStores: [parentStore],
			dependentsStores: [dependentStore],
		});

		expect(text).toContain("Derives from:");
		expect(text).toContain("$base (src/base.ts:1)");
		expect(text).toContain("Derived dependents:");
		expect(text).toContain("$derived2 (src/derived2.ts:3)");
		expect(text).toContain("Subscribers (components/hooks/effects):");
		expect(text).toContain("[component] App (src/App.tsx:10)");
	});

	it("uses store.id as fallback when name is missing", () => {
		const text = buildStoreSummaryText({
			store: makeStore({ name: undefined }),
			subscribers: [],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(text).toContain("Store: store:src/stores.ts#$counter");
	});
});

describe("buildStoreStructuredContent", () => {
	it("returns full structured content with resolution", () => {
		const result = buildStoreStructuredContent({
			store: makeStore(),
			requestedKey: "counter",
			resolutionBy: "name",
			resolutionNote: "Matched with $ prefix",
			subscribers: [makeSub()],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(result.store).toEqual({
			id: "store:src/stores.ts#$counter",
			file: "src/stores.ts",
			line: 5,
			kind: "atom",
			name: "$counter",
		});

		expect(result.resolution).toEqual({
			by: "name",
			requested: "counter",
			note: "Matched with $ prefix",
		});

		expect(result.subscribers).toHaveLength(1);
		expect(result.subscribers[0].name).toBe("App");

		expect(result.derivesFrom.stores).toEqual([]);
		expect(result.derivedDependents.stores).toEqual([]);
	});

	it("omits resolution when requestedKey is not provided", () => {
		const result = buildStoreStructuredContent({
			store: makeStore(),
			subscribers: [],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(result.resolution).toBeUndefined();
	});

	it("maps all neighbor arrays correctly", () => {
		const parent = makeStore({ id: "store:a#$a", name: "$a", file: "a.ts", line: 1 });
		const dependent = makeStore({ id: "store:b#$b", name: "$b", file: "b.ts", line: 2 });

		const result = buildStoreStructuredContent({
			store: makeStore(),
			requestedKey: "$counter",
			subscribers: [],
			derivesFromStores: [parent],
			dependentsStores: [dependent],
		});

		expect(result.derivesFrom.stores).toHaveLength(1);
		expect(result.derivesFrom.stores[0].id).toBe("store:a#$a");
		expect(result.derivedDependents.stores).toHaveLength(1);
		expect(result.derivedDependents.stores[0].id).toBe("store:b#$b");
	});

	it("maps derivesFrom and dependents edges into relations", () => {
		const parent = makeStore({ id: "store:a#$a", name: "$a", file: "a.ts", line: 1 });
		const store = makeStore({ id: "store:src/stores.ts#$computed", kind: "computed" });
		const dependent = makeStore({ id: "store:b#$b", name: "$b", file: "b.ts", line: 2 });

		const derivesFromEdges: StoreRelation[] = [
			{ type: "derives_from", from: store.id, to: parent.id, file: "src/stores.ts", line: 5 },
		];
		const dependentsEdges: StoreRelation[] = [
			{ type: "derives_from", from: dependent.id, to: store.id, file: "b.ts", line: 2 },
		];

		const result = buildStoreStructuredContent({
			store,
			requestedKey: "$computed",
			subscribers: [],
			derivesFromStores: [parent],
			derivesFromEdges,
			dependentsStores: [dependent],
			dependentsEdges,
		});

		expect(result.derivesFrom.relations).toHaveLength(1);
		expect(result.derivesFrom.relations[0]).toEqual({
			from: store.id,
			to: parent.id,
			type: "derives_from",
			file: "src/stores.ts",
			line: 5,
		});

		expect(result.derivedDependents.relations).toHaveLength(1);
		expect(result.derivedDependents.relations[0]).toEqual({
			from: dependent.id,
			to: store.id,
			type: "derives_from",
			file: "b.ts",
			line: 2,
		});
	});

	it("defaults relations to empty arrays when edges not provided", () => {
		const result = buildStoreStructuredContent({
			store: makeStore(),
			requestedKey: "$counter",
			subscribers: [],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(result.derivesFrom.relations).toEqual([]);
		expect(result.derivedDependents.relations).toEqual([]);
	});

	it("omits optional file/line from relations when absent on edges", () => {
		const edge: StoreRelation = {
			type: "derives_from",
			from: "store:a#$a",
			to: "store:b#$b",
		};

		const result = buildStoreStructuredContent({
			store: makeStore(),
			requestedKey: "$counter",
			subscribers: [],
			derivesFromStores: [],
			derivesFromEdges: [edge],
			dependentsStores: [],
		});

		const rel = result.derivesFrom.relations[0];
		expect(rel.from).toBe("store:a#$a");
		expect(rel.to).toBe("store:b#$b");
		expect("file" in rel).toBe(false);
		expect("line" in rel).toBe(false);
	});

	it("passes through resolutionBy value correctly for id resolution", () => {
		const result = buildStoreStructuredContent({
			store: makeStore(),
			requestedKey: "store:src/stores.ts#$counter",
			resolutionBy: "id",
			subscribers: [],
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(result.resolution).toBeDefined();
		expect(result.resolution!.by).toBe("id");
		expect(result.resolution!.requested).toBe("store:src/stores.ts#$counter");
	});
});
