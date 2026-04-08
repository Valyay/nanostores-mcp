import type { StoreMatch, StoreRelation, SubscriberMatch, MutatorMatch } from "../../domain/project/types.js";

export interface StoreStructuredContent extends Record<string, unknown> {
	store: {
		id: string;
		file: string;
		line: number;
		kind: string;
		name?: string;
		valueType?: string;
		flags?: import("../../domain/project/types.js").StoreFlags;
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
	mutators: Array<{
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
	mutators?: MutatorMatch[];
	derivesFromStores: StoreMatch[];
	derivesFromEdges?: StoreRelation[];
	dependentsStores: StoreMatch[];
	dependentsEdges?: StoreRelation[];
}): StoreStructuredContent {
	const {
		store,
		requestedKey,
		resolutionBy,
		resolutionNote,
		subscribers,
		mutators = [],
		derivesFromStores,
		derivesFromEdges = [],
		dependentsStores,
		dependentsEdges = [],
	} = args;

	return {
		store: {
			id: store.id,
			file: store.file,
			line: store.line,
			kind: store.kind,
			name: store.name,
			...(store.valueType && { valueType: store.valueType }),
			...(store.flags && { flags: store.flags }),
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
		mutators: mutators.map(mut => ({
			id: mut.id,
			file: mut.file,
			line: mut.line,
			kind: mut.kind,
			name: mut.name,
			storeIds: mut.storeIds,
		})),
		derivesFrom: {
			stores: derivesFromStores.map(s => ({
				id: s.id,
				file: s.file,
				line: s.line,
				kind: s.kind,
				name: s.name,
			})),
			relations: derivesFromEdges.map(e => ({
				from: e.from,
				to: e.to,
				type: e.type,
				...(e.file && { file: e.file }),
				...(e.line !== undefined && { line: e.line }),
			})),
		},
		derivedDependents: {
			stores: dependentsStores.map(s => ({
				id: s.id,
				file: s.file,
				line: s.line,
				kind: s.kind,
				name: s.name,
			})),
			relations: dependentsEdges.map(e => ({
				from: e.from,
				to: e.to,
				type: e.type,
				...(e.file && { file: e.file }),
				...(e.line !== undefined && { line: e.line }),
			})),
		},
	};
}

export function buildStoreSummaryText(args: {
	store: StoreMatch;
	resolutionBy?: string;
	resolutionRequested?: string;
	resolutionNote?: string;
	subscribers: SubscriberMatch[];
	mutators?: MutatorMatch[];
	derivesFromStores: StoreMatch[];
	dependentsStores: StoreMatch[];
}): string {
	const {
		store,
		resolutionBy,
		resolutionRequested,
		resolutionNote,
		subscribers,
		mutators = [],
		derivesFromStores,
		dependentsStores,
	} = args;

	const lines: string[] = [];

	lines.push(`Store: ${store.name ?? store.id}`);
	lines.push(`Kind: ${store.kind}`);
	if (store.valueType) lines.push(`Type: ${store.valueType}`);
	lines.push(`File: ${store.file}:${store.line}`);

	if (store.flags && Object.keys(store.flags).length > 0) {
		lines.push("");
		lines.push("Semantic risk signals:");
		if (store.flags.computedHasSideEffects) {
			lines.push("  ⚠ computedHasSideEffects: callback contains side-effectful calls (.set, .subscribe, setTimeout, etc.) — read source before assuming pure derivation");
		}
		if (store.flags.computedHasCleanupCalls) {
			lines.push("  ⚠ computedHasCleanupCalls: callback contains .destroy() calls — typical lifecycle cleanup pattern, verify it is intentional");
		}
		if (store.flags.isInsideFactory) {
			lines.push("  ⚠ isInsideFactory: declared inside a function — may be absent from storeKinds count and hub ranking");
		}
		if (store.flags.hasMountDependentActivation) {
			lines.push("  ⚠ hasMountDependentActivation: lazy activation via onMount — behavior only starts when the store has active subscribers");
		}
		if (store.flags.writtenWithoutSubscribers) {
			lines.push("  ⚠ writtenWithoutSubscribers: mutators exist but no reactive subscribers detected — may be imperative-only usage, dead code, or subscribers hidden from static analysis");
		}
		if (store.flags.readViaGetOnly) {
			lines.push("  ⚠ readViaGetOnly: read only via .get() calls, no useStore/subscribe detected — imperative access pattern, not reactive");
		}
		if (store.flags.storyOrTestOnlyWriter) {
			lines.push("  ⚠ storyOrTestOnlyWriter: all detected mutations come from test/story files — store is not written in production code");
		}
	}

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

	if (mutators.length > 0) {
		lines.push("");
		lines.push("Mutated by (functions/actions that write to this store):");
		for (const mut of mutators) {
			const displayName = mut.name || mut.id;
			lines.push(`- [${mut.kind}] ${displayName} (${mut.file}:${mut.line})`);
		}
	} else {
		lines.push("");
		lines.push("Mutated by: 0 detected by static analysis");
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
		lines.push("Subscribers: 0 detected by static analysis");
	}

	return lines.join("\n");
}
