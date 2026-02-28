import { describe, expect, it } from "vitest";
import {
	filterStoreNames,
	deduplicateAndSort,
} from "../../../../src/mcp/shared/storeAutocomplete.ts";

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
