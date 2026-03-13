import type {
	RuntimeAnalysisService,
	NanostoresLoggerEvent,
	StoreRuntimeStats,
} from "../../domain/index.js";

/**
 * Sum of all event-type counters for a single store.
 */
export function getStoreEventCount(store: StoreRuntimeStats): number {
	return (
		store.mounts +
		store.unmounts +
		store.changes +
		store.actionsStarted +
		store.actionsCompleted +
		store.actionsErrored
	);
}

/**
 * Milliseconds since the store's last value change, or `undefined` if it never changed.
 */
export function getLastChangeMsAgo(store: StoreRuntimeStats, now: number): number | undefined {
	if (!store.lastChange) return undefined;
	return Math.max(0, now - store.lastChange.timestamp);
}

/**
 * Return the highest-priority event kind the store has produced,
 * useful as a quick "what is this store doing?" indicator.
 */
export function pickExampleEventType(store: StoreRuntimeStats): string | undefined {
	if (store.changes > 0) return "change";
	if (store.actionsErrored > 0) return "action-error";
	if (store.actionsStarted > 0) return "action-start";
	if (store.mounts > 0) return "mount";
	if (store.unmounts > 0) return "unmount";
	return undefined;
}

/**
 * Peak change-events-per-second over a 1 s sliding window.
 * Returns `undefined` when there are no change events.
 */
export function computeMaxChangesPerSecond(events: NanostoresLoggerEvent[]): number | undefined {
	const timestamps = events
		.filter(event => event.kind === "change")
		.map(event => event.timestamp)
		.sort((a, b) => a - b);

	if (timestamps.length === 0) return undefined;

	let max = 1;
	let start = 0;

	for (let end = 0; end < timestamps.length; end++) {
		while (timestamps[end] - timestamps[start] > 1000) {
			start += 1;
		}
		const count = end - start + 1;
		if (count > max) {
			max = count;
		}
	}

	return max;
}

/**
 * For each store, resolve its static-analysis identity (id, kind, file)
 * by querying the project index through the runtime service.
 */
export async function buildStaticHints(
	runtimeService: RuntimeAnalysisService,
	stores: StoreRuntimeStats[],
): Promise<Map<string, { id?: string; kind?: string; file?: string }>> {
	const entries = await Promise.all(
		stores.map(async store => {
			if (!store.projectRoot) {
				return [store.storeName, {}] as const;
			}
			const profile = await runtimeService.getStoreProfile(store.storeName, store.projectRoot);
			return [
				store.storeName,
				{
					id: profile?.id,
					kind: profile?.kind,
					file: profile?.file,
				},
			] as const;
		}),
	);

	return new Map(entries);
}
