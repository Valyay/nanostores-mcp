import { describe, expect, it } from "vitest";
import { addRelation, resolveDerivedRelations } from "../../../src/domain/project/scanner/relations.ts";
import type { StoreMatch, StoreRelation } from "../../../src/domain/project/types.ts";

function createStore(id: string, file: string, name: string): StoreMatch {
	return {
		id,
		file,
		line: 1,
		kind: "atom",
		name,
	};
}

describe("scanner/relations", () => {
	it("deduplicates relations by key", () => {
		const relations: StoreRelation[] = [];
		const keys = new Set<string>();

		const rel = {
			type: "declares" as const,
			from: "file:src/stores.ts",
			to: "store:src/stores.ts#$a",
			file: "src/stores.ts",
			line: 1,
		};

		addRelation(rel, relations, keys);
		addRelation(rel, relations, keys);

		expect(relations.length).toBe(1);
	});

	it("resolves derived relations by symbol, then by name", () => {
		const derived = createStore("store:src/derived.ts#$derived", "src/derived.ts", "$derived");
		const baseA = createStore("store:src/base.ts#$a", "src/base.ts", "$a");
		const baseB = createStore("store:src/other.ts#$a", "src/other.ts", "$a");

		const relations: StoreRelation[] = [];
		const relationKeys = new Set<string>();

		const storesByName = new Map<string, StoreMatch[]>();
		storesByName.set("$derived", [derived]);
		storesByName.set("$a", [baseA, baseB]);

		const storesBySymbol = new Map<string, StoreMatch[]>();
		storesBySymbol.set("derivedKey", [derived]);
		storesBySymbol.set("baseKey", [baseA]);

		resolveDerivedRelations(
			[
				{
					derivedVar: "$derived",
					dependsOnVar: "$a",
					file: "src/derived.ts",
					line: 3,
					derivedSymbolKey: "derivedKey",
					dependsOnSymbolKey: "baseKey",
				},
				{
					derivedVar: "$derived",
					dependsOnVar: "$a",
					file: "src/derived.ts",
					line: 4,
				},
			],
			{ storesByName, storesBySymbol, relations, relationKeys },
		);

		const symbolEdge = relations.find(
			rel => rel.type === "derives_from" && rel.from === derived.id && rel.to === baseA.id,
		);
		expect(symbolEdge).toBeTruthy();

		const fallbackEdges = relations.filter(
			rel => rel.type === "derives_from" && rel.from === derived.id && rel.file === "src/derived.ts",
		);
		expect(fallbackEdges.some(rel => rel.to === baseB.id)).toBe(true);
	});
});
