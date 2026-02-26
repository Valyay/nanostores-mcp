import { describe, expect, it } from "vitest";

/**
 * Test the query parameter parsing and key normalization logic
 * used by runtime MCP resource handlers (src/mcp/resources/runtime.ts).
 *
 * We replicate the logic here because the actual handlers are registered
 * as callbacks on McpServer and not directly callable.
 */

/** Mirrors the events filter parsing at runtime.ts:57-63 */
function parseEventsFilter(searchParams: URLSearchParams): {
	storeName?: string;
	kinds: string[];
	sinceTs?: number;
	limit: number;
	actionName?: string;
} {
	return {
		storeName: searchParams.get("storeName") || undefined,
		kinds: searchParams.getAll("kind"),
		sinceTs: searchParams.has("since")
			? Number.parseInt(searchParams.get("since")!, 10)
			: undefined,
		limit: searchParams.has("limit") ? Number.parseInt(searchParams.get("limit")!, 10) : 100,
		actionName: searchParams.get("actionName") || undefined,
	};
}

/** Mirrors the store key normalization at runtime.ts:173-190 */
function normalizeStoreKey(key: string): { cleanStoreName: string; candidates: string[] } {
	let storeName = key;

	if (storeName.startsWith("store:")) {
		const hashIndex = storeName.indexOf("#");
		if (hashIndex !== -1) {
			storeName = storeName.slice(hashIndex + 1);
		}
	}

	const cleanStoreName = storeName.startsWith("$") ? storeName.slice(1) : storeName;

	// Both with and without $ prefix are tried
	return {
		cleanStoreName,
		candidates: [`$${cleanStoreName}`, cleanStoreName],
	};
}

describe("runtime resource: events filter parsing", () => {
	it("parses standard query params", () => {
		const params = new URLSearchParams(
			"storeName=$counter&kind=change&since=1000&limit=50&actionName=inc",
		);
		const filter = parseEventsFilter(params);

		expect(filter.storeName).toBe("$counter");
		expect(filter.kinds).toEqual(["change"]);
		expect(filter.sinceTs).toBe(1000);
		expect(filter.limit).toBe(50);
		expect(filter.actionName).toBe("inc");
	});

	it("defaults limit to 100 when absent", () => {
		const filter = parseEventsFilter(new URLSearchParams());
		expect(filter.limit).toBe(100);
	});

	it("handles multiple kind params", () => {
		const params = new URLSearchParams("kind=change&kind=mount&kind=unmount");
		const filter = parseEventsFilter(params);
		expect(filter.kinds).toEqual(["change", "mount", "unmount"]);
	});

	it("produces NaN for non-numeric since (current behavior)", () => {
		const params = new URLSearchParams("since=abc");
		const filter = parseEventsFilter(params);
		expect(Number.isNaN(filter.sinceTs)).toBe(true);
	});

	it("produces NaN for non-numeric limit (current behavior)", () => {
		const params = new URLSearchParams("limit=xyz");
		const filter = parseEventsFilter(params);
		expect(Number.isNaN(filter.limit)).toBe(true);
	});

	it("treats absent params as undefined", () => {
		const filter = parseEventsFilter(new URLSearchParams());
		expect(filter.storeName).toBeUndefined();
		expect(filter.kinds).toEqual([]);
		expect(filter.sinceTs).toBeUndefined();
		expect(filter.actionName).toBeUndefined();
	});
});

describe("runtime resource: store key normalization", () => {
	it('normalizes "$name" to candidates [$name, name]', () => {
		const result = normalizeStoreKey("$counter");
		expect(result.candidates).toEqual(["$counter", "counter"]);
	});

	it('normalizes plain "name" to candidates [$name, name]', () => {
		const result = normalizeStoreKey("counter");
		expect(result.candidates).toEqual(["$counter", "counter"]);
	});

	it("extracts name from full store id (store:path#$name)", () => {
		const result = normalizeStoreKey("store:src/stores/cart.ts#$cartTotal");
		expect(result.candidates).toEqual(["$cartTotal", "cartTotal"]);
	});

	it("extracts name from id without $ prefix (store:path#name)", () => {
		const result = normalizeStoreKey("store:src/stores.ts#counter");
		expect(result.candidates).toEqual(["$counter", "counter"]);
	});

	it("handles store: prefix without # (no name segment)", () => {
		// When there's no #, the key stays as "store:path"
		const result = normalizeStoreKey("store:src/stores.ts");
		expect(result.cleanStoreName).toBe("store:src/stores.ts");
	});

	it("handles key with multiple # characters", () => {
		const result = normalizeStoreKey("store:path#name#extra");
		// Only first # is used for splitting
		expect(result.candidates).toEqual(["$name#extra", "name#extra"]);
	});
});
