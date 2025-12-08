import type { ProjectIndex, StoreMatch, SubscriberMatch, StoreRelation } from "./fsScanner.js";

export type StoreResolutionBy = "id" | "name" | "id_tail";

export interface StoreResolution {
	store: StoreMatch;
	by: StoreResolutionBy;
	requested: string;
	note?: string;
}

export interface StoreNeighbors {
	subscribers: SubscriberMatch[];
	derivesFromStores: StoreMatch[];
	derivesFromEdges: StoreRelation[];
	dependentsStores: StoreMatch[];
	dependentsEdges: StoreRelation[];
}

/**
 * Resolves a store by key (id, name, or id tail) with optional file disambiguation.
 *
 * Resolution strategy:
 * 1. If key looks like a full id (starts with "store:"), match by id
 * 2. Otherwise, treat as name and try:
 *    a) Direct name match (supports both "$counter" and "counter")
 *    b) If file is provided, filter matches by file
 *    c) If multiple matches, use first by file sort order
 * 3. Fallback: try to match by id tail (last part after '#')
 */
export function resolveStore(
	index: ProjectIndex,
	key: string,
	opts?: { file?: string },
): StoreResolution | null {
	const rawKey = key;

	// 1) Direct id match
	if (rawKey.startsWith("store:")) {
		const store = index.stores.find(s => s.id === rawKey);
		if (store) {
			return {
				store,
				by: "id",
				requested: rawKey,
				note: `Resolved by id: ${rawKey}`,
			};
		}

		// Fallback: try id tail for malformed ids
		const tail = rawKey.split("#").slice(-1)[0];
		if (tail) {
			const tailResult = resolveByIdTail(index, tail);
			if (tailResult) {
				return {
					...tailResult,
					requested: rawKey,
				};
			}
		}

		return null;
	}

	// 2) Name-based resolution
	const nameResult = resolveByName(index, rawKey, opts?.file);
	if (nameResult) {
		return {
			...nameResult,
			requested: rawKey,
		};
	}

	// 3) Final fallback: id tail
	const tailResult = resolveByIdTail(index, rawKey);
	if (tailResult) {
		return {
			...tailResult,
			requested: rawKey,
		};
	}

	return null;
}

/**
 * Collects all related entities for a given store:
 * - subscribers (components/hooks/effects that use this store)
 * - derivesFrom (stores this store depends on)
 * - dependents (stores that depend on this store)
 */
export function collectStoreNeighbors(index: ProjectIndex, store: StoreMatch): StoreNeighbors {
	const allRelations: StoreRelation[] = index.relations;

	// Subscribers that use this store
	const subscribers: SubscriberMatch[] = index.subscribers.filter(sub =>
		sub.storeIds.includes(store.id),
	);

	// Stores this store derives from
	const derivesFromEdges = allRelations.filter(
		r => r.type === "derives_from" && r.from === store.id,
	);
	const derivesFromIds = new Set(derivesFromEdges.map(r => r.to));
	const derivesFromStores: StoreMatch[] = index.stores.filter(s => derivesFromIds.has(s.id));

	// Stores that derive from this store (dependents)
	const dependentsEdges = allRelations.filter(r => r.type === "derives_from" && r.to === store.id);
	const dependentsIds = new Set(dependentsEdges.map(r => r.from));
	const dependentsStores: StoreMatch[] = index.stores.filter(s => dependentsIds.has(s.id));

	return {
		subscribers,
		derivesFromStores,
		derivesFromEdges,
		dependentsStores,
		dependentsEdges,
	};
}

// --- Internal resolution helpers ---

function resolveByName(
	index: ProjectIndex,
	rawName: string,
	file?: string,
): Omit<StoreResolution, "requested"> | null {
	// Support both "$counter" and "counter"
	const nameCandidates = new Set<string>();

	if (rawName.startsWith("$")) {
		nameCandidates.add(rawName); // "$counter"
		nameCandidates.add(rawName.slice(1)); // "counter"
	} else {
		nameCandidates.add(rawName); // "counter"
		nameCandidates.add(`$${rawName}`); // "$counter"
	}

	let matches = index.stores.filter(s => s.name && nameCandidates.has(s.name));

	// Filter by file if provided
	if (file) {
		matches = matches.filter(s => s.file === file);
	}

	if (matches.length === 0) {
		return null;
	}

	if (matches.length === 1) {
		return {
			store: matches[0],
			by: "name",
			note: `Resolved by name: ${rawName}`,
		};
	}

	// Multiple matches - use first by file sort order
	matches.sort((a, b) => a.file.localeCompare(b.file));
	const others = matches
		.slice(1)
		.map(s => s.file)
		.join(", ");

	return {
		store: matches[0],
		by: "name",
		note: `Resolved by name: ${rawName} (multiple matches, using first from ${matches[0].file}). Other matches in: ${others}`,
	};
}

function resolveByIdTail(
	index: ProjectIndex,
	rawName: string,
): Omit<StoreResolution, "requested"> | null {
	// Support both "$counter" and "counter"
	const nameCandidates = new Set<string>();

	if (rawName.startsWith("$")) {
		nameCandidates.add(rawName);
		nameCandidates.add(rawName.slice(1));
	} else {
		nameCandidates.add(rawName);
		nameCandidates.add(`$${rawName}`);
	}

	const tailMatches = index.stores.filter(s => {
		const tail = s.id.split("#").slice(-1)[0];
		return nameCandidates.has(tail);
	});

	if (tailMatches.length === 0) {
		return null;
	}

	if (tailMatches.length === 1) {
		return {
			store: tailMatches[0],
			by: "id_tail",
			note: `Resolved by id tail: ${rawName}`,
		};
	}

	// Multiple matches - use first by file sort order
	tailMatches.sort((a, b) => a.file.localeCompare(b.file));
	const others = tailMatches
		.slice(1)
		.map(s => s.file)
		.join(", ");

	return {
		store: tailMatches[0],
		by: "id_tail",
		note: `Resolved by id tail: ${rawName} (multiple matches, using first from ${tailMatches[0].file}). Other matches in: ${others}`,
	};
}
