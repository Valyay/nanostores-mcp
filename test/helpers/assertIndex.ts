import type { ProjectIndex, StoreRelation } from "../../src/domain/project/types.ts";
import { toPosix } from "./fixtures.ts";

export function findStore(index: ProjectIndex, name: string, file?: string) {
	const normalizedFile = file ? toPosix(file) : undefined;
	return index.stores.find(
		store => store.name === name && (!normalizedFile || toPosix(store.file) === normalizedFile),
	);
}

export function findSubscriber(index: ProjectIndex, name: string, file?: string) {
	const normalizedFile = file ? toPosix(file) : undefined;
	return index.subscribers.find(
		sub => sub.name === name && (!normalizedFile || toPosix(sub.file) === normalizedFile),
	);
}

export function hasRelation(
	index: ProjectIndex,
	rel: Pick<StoreRelation, "type" | "from" | "to">,
): boolean {
	return index.relations.some(
		entry => entry.type === rel.type && entry.from === rel.from && entry.to === rel.to,
	);
}
