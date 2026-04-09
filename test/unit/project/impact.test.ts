import { describe, expect, it } from "vitest";
import type { ProjectIndex } from "../../../src/domain/project/types.ts";
import { buildStoreImpact } from "../../../src/domain/project/summary.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const storeUser = "store:src/stores/user.ts#$user";
const storeIsLoggedIn = "store:src/stores/auth.ts#$isLoggedIn";
const storeGreeting = "store:src/stores/greeting.ts#$greeting";
const storeTitle = "store:src/stores/title.ts#$title";
const subscriberLoginButton = "subscriber:src/components/LoginButton.tsx#LoginButton";
const subscriberUserProfile = "subscriber:src/components/UserProfile.tsx#UserProfile";
const subscriberHeader = "subscriber:src/components/Header.tsx#Header";

/**
 * Graph shape:
 *
 *   $user (atom)
 *     └── $isLoggedIn (computed, derives_from $user)   ← hop 1 store
 *           └── $greeting (computed, derives_from $isLoggedIn) ← hop 2 store
 *                 └── Header (subscriber of $greeting)         ← hop 2 subscriber
 *           └── LoginButton (subscriber of $isLoggedIn)        ← hop 1 subscriber
 *     └── UserProfile (subscriber of $user)                    ← hop 1 subscriber
 */
const projectIndex: ProjectIndex = {
	rootDir: "/workspace",
	filesScanned: 5,
	stores: [
		{ id: storeUser, file: "src/stores/user.ts", line: 1, kind: "atom", name: "$user" },
		{
			id: storeIsLoggedIn,
			file: "src/stores/auth.ts",
			line: 1,
			kind: "computed",
			name: "$isLoggedIn",
		},
		{
			id: storeGreeting,
			file: "src/stores/greeting.ts",
			line: 1,
			kind: "computed",
			name: "$greeting",
		},
		{ id: storeTitle, file: "src/stores/title.ts", line: 1, kind: "atom", name: "$title" },
	],
	subscribers: [
		{
			id: subscriberLoginButton,
			file: "src/components/LoginButton.tsx",
			line: 1,
			kind: "component",
			name: "LoginButton",
			storeIds: [storeIsLoggedIn],
		},
		{
			id: subscriberUserProfile,
			file: "src/components/UserProfile.tsx",
			line: 1,
			kind: "component",
			name: "UserProfile",
			storeIds: [storeUser],
		},
		{
			id: subscriberHeader,
			file: "src/components/Header.tsx",
			line: 1,
			kind: "component",
			name: "Header",
			storeIds: [storeGreeting],
		},
	],
	relations: [
		// derives_from: from=computed, to=source
		{
			type: "derives_from",
			from: storeIsLoggedIn,
			to: storeUser,
			file: "src/stores/auth.ts",
			line: 1,
		},
		{
			type: "derives_from",
			from: storeGreeting,
			to: storeIsLoggedIn,
			file: "src/stores/greeting.ts",
			line: 1,
		},
		// subscribes_to
		{
			type: "subscribes_to",
			from: subscriberLoginButton,
			to: storeIsLoggedIn,
			file: "src/components/LoginButton.tsx",
			line: 1,
		},
		{
			type: "subscribes_to",
			from: subscriberUserProfile,
			to: storeUser,
			file: "src/components/UserProfile.tsx",
			line: 1,
		},
		{
			type: "subscribes_to",
			from: subscriberHeader,
			to: storeGreeting,
			file: "src/components/Header.tsx",
			line: 1,
		},
	],
	mutators: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildStoreImpact", () => {
	it("isolated store with no downstream returns empty hops", () => {
		const titleStore = projectIndex.stores.find(s => s.id === storeTitle)!;
		const result = buildStoreImpact(projectIndex, titleStore);

		expect(result.sourceStoreId).toBe(storeTitle);
		expect(result.hops).toEqual([]);
		expect(result.summary.totalAffectedStores).toBe(0);
		expect(result.summary.totalAffectedSubscribers).toBe(0);
		expect(result.summary.maxHops).toBe(0);
	});

	it("source with a direct subscriber reports subscriber at hop 1", () => {
		const userStore = projectIndex.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(projectIndex, userStore);

		const hop1 = result.hops.find(h => h.hop === 1);
		expect(hop1).toBeDefined();
		expect(hop1!.subscribers.map(s => s.id)).toContain(subscriberUserProfile);
	});

	it("source with a direct computed dependent reports it at hop 1", () => {
		const userStore = projectIndex.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(projectIndex, userStore);

		const hop1 = result.hops.find(h => h.hop === 1);
		expect(hop1!.derivedStores.map(s => s.id)).toContain(storeIsLoggedIn);
	});

	it("transitive chain: computed of computed appears at hop 2", () => {
		const userStore = projectIndex.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(projectIndex, userStore);

		const hop2 = result.hops.find(h => h.hop === 2);
		expect(hop2).toBeDefined();
		expect(hop2!.derivedStores.map(s => s.id)).toContain(storeGreeting);
	});

	it("subscriber of derived store appears at the same hop as the derived store", () => {
		const userStore = projectIndex.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(projectIndex, userStore);

		// LoginButton subscribes to $isLoggedIn which is at hop 1
		const hop1 = result.hops.find(h => h.hop === 1);
		expect(hop1!.subscribers.map(s => s.id)).toContain(subscriberLoginButton);

		// Header subscribes to $greeting which is at hop 2
		const hop2 = result.hops.find(h => h.hop === 2);
		expect(hop2!.subscribers.map(s => s.id)).toContain(subscriberHeader);
	});

	it("summary counts are correct across all hops", () => {
		const userStore = projectIndex.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(projectIndex, userStore);

		// $isLoggedIn (hop 1) + $greeting (hop 2) = 2 affected stores
		expect(result.summary.totalAffectedStores).toBe(2);
		// UserProfile (hop 1) + LoginButton (hop 1) + Header (hop 2) = 3 affected subscribers
		expect(result.summary.totalAffectedSubscribers).toBe(3);
		expect(result.summary.maxHops).toBe(2);
	});

	it("subscriber watching source and a derived store appears only at the earliest hop", () => {
		// Dashboard subscribes to both $user (source) and $isLoggedIn (hop 1).
		// It should appear exactly once — at hop 1, not duplicated at hop 1 again.
		const subscriberDashboard = "subscriber:src/components/Dashboard.tsx#Dashboard";
		const indexWithMultiSub: ProjectIndex = {
			...projectIndex,
			subscribers: [
				...projectIndex.subscribers,
				{
					id: subscriberDashboard,
					file: "src/components/Dashboard.tsx",
					line: 1,
					kind: "component",
					name: "Dashboard",
					storeIds: [storeUser, storeIsLoggedIn],
				},
			],
			relations: [
				...projectIndex.relations,
				{
					type: "subscribes_to",
					from: subscriberDashboard,
					to: storeUser,
					file: "src/components/Dashboard.tsx",
					line: 1,
				},
				{
					type: "subscribes_to",
					from: subscriberDashboard,
					to: storeIsLoggedIn,
					file: "src/components/Dashboard.tsx",
					line: 2,
				},
			],
		};

		const userStore = indexWithMultiSub.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(indexWithMultiSub, userStore);

		const allSubscriberIds = result.hops.flatMap(h => h.subscribers.map(s => s.id));
		// Dashboard appears exactly once despite subscribing to both $user and $isLoggedIn
		expect(allSubscriberIds.filter(id => id === subscriberDashboard)).toHaveLength(1);

		// It appears at hop 1 (earliest), not deferred to a later hop
		const hop1 = result.hops.find(h => h.hop === 1);
		expect(hop1!.subscribers.map(s => s.id)).toContain(subscriberDashboard);
	});

	it("valueType is propagated from StoreMatch to ImpactedStore", () => {
		const typedIndex: ProjectIndex = {
			...projectIndex,
			stores: [
				{
					id: storeUser,
					file: "src/stores/user.ts",
					line: 1,
					kind: "atom",
					name: "$user",
					valueType: "User",
				},
				{
					id: storeIsLoggedIn,
					file: "src/stores/auth.ts",
					line: 1,
					kind: "computed",
					name: "$isLoggedIn",
					valueType: "boolean",
				},
				{
					id: storeGreeting,
					file: "src/stores/greeting.ts",
					line: 1,
					kind: "computed",
					name: "$greeting",
					valueType: "string",
				},
				{ id: storeTitle, file: "src/stores/title.ts", line: 1, kind: "atom", name: "$title" },
			],
		};
		const userStore = typedIndex.stores.find(s => s.id === storeUser)!;
		const result = buildStoreImpact(typedIndex, userStore);

		const hop1 = result.hops.find(h => h.hop === 1);
		const isLoggedIn = hop1!.derivedStores.find(s => s.id === storeIsLoggedIn);
		expect(isLoggedIn?.valueType).toBe("boolean");

		const hop2 = result.hops.find(h => h.hop === 2);
		const greeting = hop2!.derivedStores.find(s => s.id === storeGreeting);
		expect(greeting?.valueType).toBe("string");
	});

	it("cycle protection: does not loop or repeat stores", () => {
		// A → B → A cycle
		const storeA = "store:src/a.ts#$a";
		const storeB = "store:src/b.ts#$b";
		const cyclicIndex: ProjectIndex = {
			...projectIndex,
			stores: [
				{ id: storeA, file: "src/a.ts", line: 1, kind: "computed", name: "$a" },
				{ id: storeB, file: "src/b.ts", line: 1, kind: "computed", name: "$b" },
			],
			subscribers: [],
			relations: [
				{ type: "derives_from", from: storeB, to: storeA, file: "src/b.ts", line: 1 },
				{ type: "derives_from", from: storeA, to: storeB, file: "src/a.ts", line: 1 },
			],
		};
		const aStore = cyclicIndex.stores.find(s => s.id === storeA)!;
		const result = buildStoreImpact(cyclicIndex, aStore);

		// Should terminate. B at hop 1, A already visited — no hop 2.
		const allStoreIds = result.hops.flatMap(h => h.derivedStores.map(s => s.id));
		expect(allStoreIds.filter(id => id === storeA)).toHaveLength(0); // source not repeated
		expect(allStoreIds.filter(id => id === storeB)).toHaveLength(1); // B appears exactly once
	});
});
