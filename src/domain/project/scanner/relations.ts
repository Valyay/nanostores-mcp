import type { StoreRelation, StoreMatch } from "../types.js";
import type { DerivedStub } from "./stores.js";

export function makeRelationKey(rel: StoreRelation): string {
	const filePart = rel.file ?? "";
	const linePart = rel.line != null ? String(rel.line) : "";
	return `${rel.type}|${rel.from}|${rel.to}|${filePart}|${linePart}`;
}

export function addRelation(
	rel: StoreRelation,
	relations: StoreRelation[],
	relationKeys: Set<string>,
): void {
	const key = makeRelationKey(rel);
	if (relationKeys.has(key)) return;
	relationKeys.add(key);
	relations.push(rel);
}

export interface DerivedRelationsContext {
	storesByName: Map<string, StoreMatch[]>;
	storesBySymbol: Map<string, StoreMatch[]>;
	relations: StoreRelation[];
	relationKeys: Set<string>;
}

/**
 * Resolve derived -> base (derives_from) relations from stubs
 */
export function resolveDerivedRelations(
	derivedStubs: DerivedStub[],
	context: DerivedRelationsContext,
): void {
	for (const stub of derivedStubs) {
		let derivedMatches: StoreMatch[] = [];
		let baseMatches: StoreMatch[] = [];

		// Try by symbols first
		if (stub.derivedSymbolKey) {
			derivedMatches = context.storesBySymbol.get(stub.derivedSymbolKey) ?? [];
		}
		if (stub.dependsOnSymbolKey) {
			baseMatches = context.storesBySymbol.get(stub.dependsOnSymbolKey) ?? [];
		}

		// Fallback by name
		if (derivedMatches.length === 0) {
			derivedMatches = context.storesByName.get(stub.derivedVar) ?? [];
		}
		if (baseMatches.length === 0) {
			baseMatches = context.storesByName.get(stub.dependsOnVar) ?? [];
		}

		for (const derivedStore of derivedMatches) {
			for (const baseStore of baseMatches) {
				addRelation(
					{
						type: "derives_from",
						from: derivedStore.id,
						to: baseStore.id,
						file: stub.file,
						line: stub.line,
					},
					context.relations,
					context.relationKeys,
				);
			}
		}
	}
}
