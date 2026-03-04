import { describe, expect, it, vi } from "vitest";
import {
	filterStoreNames,
	deduplicateAndSort,
	createStoreAutocomplete,
} from "../../../../src/mcp/shared/storeAutocomplete.ts";
import type { ProjectAnalysisService } from "../../../../src/domain/index.ts";

describe("store autocomplete: name filtering", () => {
	const allNames = [
		"$authUser",
		"$cart",
		"$cartItems",
		"$cartTotal",
		"$counter",
		"$darkMode",
		"$profile",
		"$settings",
		"$theme",
		"$todos",
	];

	it("returns all names (up to limit) when query is empty", () => {
		expect(filterStoreNames(allNames, "")).toEqual(allNames);
		expect(filterStoreNames(allNames, "  ")).toEqual(allNames);
	});

	it("filters by substring (case-insensitive)", () => {
		const result = filterStoreNames(allNames, "cart");
		expect(result).toEqual(["$cart", "$cartItems", "$cartTotal"]);
	});

	it("is case-insensitive", () => {
		expect(filterStoreNames(allNames, "CART")).toEqual(["$cart", "$cartItems", "$cartTotal"]);
	});

	it("matches $ prefix in names", () => {
		const result = filterStoreNames(allNames, "$dark");
		expect(result).toEqual(["$darkMode"]);
	});

	it("returns empty array when no match", () => {
		expect(filterStoreNames(allNames, "zzz")).toEqual([]);
	});

	it("respects the limit parameter", () => {
		const manyNames = Array.from({ length: 30 }, (_, i) => `$store${i}`);
		expect(filterStoreNames(manyNames, "")).toHaveLength(20);
		expect(filterStoreNames(manyNames, "store", 5)).toHaveLength(5);
	});
});

describe("store autocomplete: name deduplication", () => {
	it("removes duplicates and sorts", () => {
		const names = ["$b", "$a", "$c", "$a", "$b"];
		expect(deduplicateAndSort(names)).toEqual(["$a", "$b", "$c"]);
	});

	it("filters out empty and whitespace-only names", () => {
		const names = ["$a", "", "  ", "$b"];
		expect(deduplicateAndSort(names)).toEqual(["$a", "$b"]);
	});

	it("handles empty input", () => {
		expect(deduplicateAndSort([])).toEqual([]);
	});
});

describe("createStoreAutocomplete", () => {
	function createMockService(names: string[]): ProjectAnalysisService {
		return {
			getStoreNames: vi.fn().mockResolvedValue(names),
			getIndex: vi.fn(),
			getStoreByKey: vi.fn(),
			getStoreNeighbors: vi.fn(),
			findStoreByRuntimeKey: vi.fn(),
			clearCache: vi.fn(),
		} as unknown as ProjectAnalysisService;
	}

	it("returns filtered store names via suggestStoreNames", async () => {
		const service = createMockService(["$cart", "$counter", "$theme"]);
		const { suggestStoreNames } = createStoreAutocomplete(service);

		const result = await suggestStoreNames("cart");
		expect(result).toEqual(["$cart"]);
	});

	it("returns all names for empty query", async () => {
		const service = createMockService(["$a", "$b", "$c"]);
		const { suggestStoreNames } = createStoreAutocomplete(service);

		const result = await suggestStoreNames("");
		expect(result).toEqual(["$a", "$b", "$c"]);
	});

	it("caches names — second call does not hit service again", async () => {
		const service = createMockService(["$x"]);
		const { suggestStoreNames } = createStoreAutocomplete(service);

		await suggestStoreNames("");
		await suggestStoreNames("x");

		expect(service.getStoreNames).toHaveBeenCalledTimes(1);
	});

	it("resetCache allows a fresh fetch", async () => {
		const service = createMockService(["$old"]);
		const { suggestStoreNames, resetCache } = createStoreAutocomplete(service);

		await suggestStoreNames("");
		expect(service.getStoreNames).toHaveBeenCalledTimes(1);

		resetCache();
		(service.getStoreNames as ReturnType<typeof vi.fn>).mockResolvedValue(["$new"]);
		const result = await suggestStoreNames("");
		expect(result).toEqual(["$new"]);
		expect(service.getStoreNames).toHaveBeenCalledTimes(2);
	});
});
