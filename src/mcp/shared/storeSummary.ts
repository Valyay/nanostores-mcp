import type { StoreMatch, SubscriberMatch } from "../../domain/fsScanner/index.js";

export interface StoreStructuredContent extends Record<string, unknown> {
	store: {
		id: string;
		file: string;
		line: number;
		kind: string;
		name?: string;
	};
	resolution?: {
		by?: string;
		requested?: string;
		note?: string;
	};
	subscribers: Array<{
		id: string;
		file: string;
		line: number;
		kind: string;
		name?: string;
		storeIds: string[];
	}>;
	derivesFrom: {
		stores: Array<{
			id: string;
			file: string;
			line: number;
			kind: string;
			name?: string;
		}>;
		relations: Array<{
			from: string;
			to: string;
			type: string;
			file?: string;
			line?: number;
		}>;
	};
	derivedDependents: {
		stores: Array<{
			id: string;
			file: string;
			line: number;
			kind: string;
			name?: string;
		}>;
		relations: Array<{
			from: string;
			to: string;
			type: string;
			file?: string;
			line?: number;
		}>;
	};
}

export function buildStoreStructuredContent(args: {
	store: StoreMatch;
	requestedKey?: string;
	resolutionBy?: string;
	resolutionNote?: string;
	subscribers: SubscriberMatch[];
	derivesFromStores: StoreMatch[];
	dependentsStores: StoreMatch[];
}): StoreStructuredContent {
	const {
		store,
		requestedKey,
		resolutionBy,
		resolutionNote,
		subscribers,
		derivesFromStores,
		dependentsStores,
	} = args;

	return {
		store: {
			id: store.id,
			file: store.file,
			line: store.line,
			kind: store.kind,
			name: store.name,
		},
		...(requestedKey && {
			resolution: {
				...(resolutionBy && { by: resolutionBy }),
				requested: requestedKey,
				...(resolutionNote && { note: resolutionNote }),
			},
		}),
		subscribers: subscribers.map(sub => ({
			id: sub.id,
			file: sub.file,
			line: sub.line,
			kind: sub.kind,
			name: sub.name,
			storeIds: sub.storeIds,
		})),
		derivesFrom: {
			stores: derivesFromStores.map(s => ({
				id: s.id,
				file: s.file,
				line: s.line,
				kind: s.kind,
				name: s.name,
			})),
			relations: [], // TODO: expose edges from domain layer
		},
		derivedDependents: {
			stores: dependentsStores.map(s => ({
				id: s.id,
				file: s.file,
				line: s.line,
				kind: s.kind,
				name: s.name,
			})),
			relations: [], // TODO: expose edges from domain layer
		},
	};
}

export function buildStoreSummaryText(args: {
	store: StoreMatch;
	resolutionBy?: string;
	resolutionRequested?: string;
	resolutionNote?: string;
	subscribers: SubscriberMatch[];
	derivesFromStores: StoreMatch[];
	dependentsStores: StoreMatch[];
}): string {
	const {
		store,
		resolutionBy,
		resolutionRequested,
		resolutionNote,
		subscribers,
		derivesFromStores,
		dependentsStores,
	} = args;

	const lines: string[] = [];

	lines.push(`Store: ${store.name ?? store.id}`);
	lines.push(`Kind: ${store.kind}`);
	lines.push(`File: ${store.file}:${store.line}`);

	if (resolutionBy && resolutionRequested) {
		lines.push("");
		lines.push(`Resolved by: ${resolutionBy} (requested: ${resolutionRequested})`);
		if (resolutionNote) {
			lines.push(resolutionNote);
		}
	}

	lines.push("");

	if (derivesFromStores.length > 0) {
		lines.push("Derives from:");
		for (const s of derivesFromStores) {
			lines.push(`- ${s.name ?? s.id} (${s.file}:${s.line})`);
		}
	} else {
		lines.push("Derives from: none (base store)");
	}

	if (dependentsStores.length > 0) {
		lines.push("");
		lines.push("Derived dependents:");
		for (const s of dependentsStores) {
			lines.push(`- ${s.name ?? s.id} (${s.file}:${s.line})`);
		}
	} else {
		lines.push("");
		lines.push("Derived dependents: none");
	}

	if (subscribers.length > 0) {
		lines.push("");
		lines.push("Subscribers (components/hooks/effects):");
		for (const sub of subscribers) {
			const displayName = sub.name || sub.id;
			lines.push(`- [${sub.kind}] ${displayName} (${sub.file}:${sub.line})`);
		}
	} else {
		lines.push("");
		lines.push("Subscribers: none found");
	}

	return lines.join("\n");
}
