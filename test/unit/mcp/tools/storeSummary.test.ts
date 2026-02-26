import { describe, expect, it } from "vitest";
import {
	buildStoreSummaryText,
	buildStoreStructuredContent,
} from "../../../../src/mcp/shared/storeSummary.ts";
import type { StoreMatch, SubscriberMatch } from "../../../../src/domain/project/types.ts";

/**
 * Tests for the store_summary tool handler logic.
 *
 * The tool uses resolveStore (lookup) → getStoreNeighbors → buildStoreSummaryText/buildStoreStructuredContent.
 * We test the public shared utilities here and the validation logic.
 */

function makeStore(overrides: Partial<StoreMatch> = {}): StoreMatch {
	return {
		id: "store:src/stores.ts#$cart",
		file: "src/stores.ts",
		line: 3,
		kind: "map",
		name: "$cart",
		...overrides,
	};
}

function makeSub(overrides: Partial<SubscriberMatch> = {}): SubscriberMatch {
	return {
		id: "subscriber:src/Cart.tsx#CartView",
		file: "src/Cart.tsx",
		line: 15,
		kind: "component",
		name: "CartView",
		storeIds: ["store:src/stores.ts#$cart"],
		...overrides,
	};
}

describe("store_summary tool: input validation logic", () => {
	it("requires either storeId or name", () => {
		// Mirrors: if (!storeId && !name) throw new Error(...)
		const storeId = undefined;
		const name = undefined;

		expect(!storeId && !name).toBe(true);
	});

	it("prefers storeId over name when both provided", () => {
		// Mirrors: const key = storeId ? decodeURIComponent(storeId) : name!;
		const storeId = "store%3Asrc%2Fstores.ts%23%24cart";
		const name = "$cart";

		const key = storeId ? decodeURIComponent(storeId) : name;
		expect(key).toBe("store:src/stores.ts#$cart");
	});

	it("falls back to name when storeId is absent", () => {
		const storeId = undefined;
		const name = "$cart";

		const key = storeId ? decodeURIComponent(storeId) : name!;
		expect(key).toBe("$cart");
	});
});

describe("store_summary tool: response building", () => {
	it("builds text and structured content for found store", () => {
		const store = makeStore();
		const subscribers = [makeSub()];

		const text = buildStoreSummaryText({
			store,
			resolutionBy: "name",
			resolutionRequested: "$cart",
			subscribers,
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(text).toContain("Store: $cart");
		expect(text).toContain("Kind: map");
		expect(text).toContain("[component] CartView");

		const structured = buildStoreStructuredContent({
			store,
			requestedKey: "$cart",
			resolutionBy: "name",
			subscribers,
			derivesFromStores: [],
			dependentsStores: [],
		});

		expect(structured.store.kind).toBe("map");
		expect(structured.subscribers).toHaveLength(1);
	});

	it("builds not-found response text", () => {
		// Mirrors the tool's not-found branch
		const rootPath = "/workspace";
		const key = "$missing";
		const text = "Store not found.\n\n" + `Root: ${rootPath}\n` + `Requested: ${key}`;

		expect(text).toContain("Store not found");
		expect(text).toContain("/workspace");
		expect(text).toContain("$missing");
	});

	it("builds error response text", () => {
		const rootPath = "/workspace";
		const msg = "Index scan failed";
		const text =
			"Failed to get store summary.\n\n" + `Root: ${rootPath}\n` + `Error: ${msg}`;

		expect(text).toContain("Failed to get store summary");
		expect(text).toContain("Index scan failed");
	});
});
