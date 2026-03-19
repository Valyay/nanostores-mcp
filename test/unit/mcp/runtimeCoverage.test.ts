import { describe, expect, it, vi } from "vitest";
import type { ProjectAnalysisService } from "../../../src/domain/project/service.ts";
import type { ProjectIndex, StoreMatch } from "../../../src/domain/project/types.ts";
import { createLoggerEventStore } from "../../../src/domain/runtime/eventStore.ts";
import { createRuntimeAnalysisService } from "../../../src/domain/runtime/service.ts";
import { buildCoverageSummary } from "../../../src/mcp/tools/runtime.ts";

function makeStoreMatch(name: string, kind: string, file: string): StoreMatch {
	return {
		id: `store:${file}#${name}`,
		file,
		line: 1,
		kind: kind as StoreMatch["kind"],
		name,
	};
}

function makeProjectService(stores: StoreMatch[]): ProjectAnalysisService {
	const index: ProjectIndex = {
		rootDir: "/root",
		filesScanned: 1,
		stores,
		subscribers: [],
		relations: [],
	};
	return {
		getIndex: vi.fn(async () => index),
		getStoreByKey: vi.fn(),
		resolveStoreByKey: vi.fn(),
		getStoreNeighbors: vi.fn(),
		getStoreNames: vi.fn(),
		findStoreByRuntimeKey: vi.fn(),
		clearCache: vi.fn(),
	} as unknown as ProjectAnalysisService;
}

function createEvent(
	kind: string,
	storeName: string,
	timestamp: number,
	extra: Record<string, unknown> = {},
): {
	kind: string;
	storeName: string;
	timestamp: number;
	[key: string]: unknown;
} {
	return { kind, storeName, timestamp, ...extra };
}

describe("runtime coverage report", () => {
	it("all stores covered → coveredCount === staticStoreCount, staticOnlyCount === 0", async () => {
		const stores = [
			makeStoreMatch("$counter", "atom", "stores.ts"),
			makeStoreMatch("$user", "map", "user.ts"),
		];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("change", "$counter", 100, { projectRoot: "/root" }) as never);
		eventStore.add(createEvent("mount", "$user", 200, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.staticStoreCount).toBe(2);
		expect(report.runtimeStoreCount).toBe(2);
		expect(report.coveredCount).toBe(2);
		expect(report.staticOnlyCount).toBe(0);
		expect(report.runtimeOnlyCount).toBe(0);
	});

	it("partial coverage → staticOnlyCount > 0 with correct names", async () => {
		const stores = [
			makeStoreMatch("$counter", "atom", "stores.ts"),
			makeStoreMatch("$filtered", "computed", "computed.ts"),
			makeStoreMatch("$sorted", "computed", "computed.ts"),
		];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("change", "$counter", 100, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.coveredCount).toBe(1);
		expect(report.staticOnlyCount).toBe(2);
		const staticOnlyNames = report.stores
			.filter(s => s.inStaticGraph && !s.inRuntime)
			.map(s => s.storeName)
			.sort();
		expect(staticOnlyNames).toEqual(["$filtered", "$sorted"]);
	});

	it("runtime-only stores (not in static graph) → runtimeOnlyCount > 0", async () => {
		const projectService = makeProjectService([makeStoreMatch("$counter", "atom", "stores.ts")]);
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("change", "$counter", 100, { projectRoot: "/root" }) as never);
		eventStore.add(createEvent("change", "$dynamic", 200, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.runtimeOnlyCount).toBe(1);
		const runtimeOnly = report.stores.filter(s => !s.inStaticGraph && s.inRuntime);
		expect(runtimeOnly[0].storeName).toBe("$dynamic");
	});

	it("empty runtime (app not running) → all staticOnly", async () => {
		const stores = [
			makeStoreMatch("$a", "atom", "a.ts"),
			makeStoreMatch("$b", "map", "b.ts"),
		];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.runtimeStoreCount).toBe(0);
		expect(report.staticOnlyCount).toBe(2);
		expect(report.coveredCount).toBe(0);
	});

	it("empty static (no project) → all runtimeOnly", async () => {
		const projectService = makeProjectService([]);
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("change", "$x", 100, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.staticStoreCount).toBe(0);
		expect(report.runtimeOnlyCount).toBe(1);
	});

	it("coverageByKind aggregates correctly", async () => {
		const stores = [
			makeStoreMatch("$a", "atom", "a.ts"),
			makeStoreMatch("$b", "atom", "a.ts"),
			makeStoreMatch("$c", "computed", "c.ts"),
			makeStoreMatch("$d", "computed", "c.ts"),
			makeStoreMatch("$e", "map", "m.ts"),
		];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("change", "$a", 100, { projectRoot: "/root" }) as never);
		eventStore.add(createEvent("change", "$b", 200, { projectRoot: "/root" }) as never);
		eventStore.add(createEvent("change", "$e", 300, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.coverageByKind["atom"]).toEqual({ total: 2, covered: 2 });
		expect(report.coverageByKind["computed"]).toEqual({ total: 2, covered: 0 });
		expect(report.coverageByKind["map"]).toEqual({ total: 1, covered: 1 });
	});

	it("rootless runtime events are included in any root's coverage", async () => {
		const stores = [makeStoreMatch("$counter", "atom", "stores.ts")];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);
		// Rootless event (no projectRoot) — backward-compat client
		eventStore.add(createEvent("change", "$counter", 100) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.coveredCount).toBe(1);
		expect(report.runtimeStoreCount).toBe(1);
		const entry = report.stores.find(s => s.storeName === "$counter")!;
		expect(entry.inRuntime).toBe(true);
		expect(entry.runtimeChanges).toBe(1);
	});

	it("getIndex failure produces runtime-only report", async () => {
		const projectService = {
			getIndex: vi.fn(async () => {
				throw new Error("scan failed");
			}),
			getStoreByKey: vi.fn(),
			resolveStoreByKey: vi.fn(),
			getStoreNeighbors: vi.fn(),
			getStoreNames: vi.fn(),
			findStoreByRuntimeKey: vi.fn(),
			clearCache: vi.fn(),
		} as unknown as ProjectAnalysisService;
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("change", "$x", 100, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.staticStoreCount).toBe(0);
		expect(report.runtimeStoreCount).toBe(1);
		expect(report.runtimeOnlyCount).toBe(1);
	});

	it("populates runtimeChanges and runtimeMounts in coverage entries", async () => {
		const stores = [makeStoreMatch("$counter", "atom", "stores.ts")];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);
		eventStore.add(createEvent("mount", "$counter", 100, { projectRoot: "/root" }) as never);
		eventStore.add(createEvent("change", "$counter", 200, { projectRoot: "/root" }) as never);
		eventStore.add(createEvent("change", "$counter", 300, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		const entry = report.stores.find(s => s.storeName === "$counter")!;
		expect(entry.runtimeChanges).toBe(2);
		expect(entry.runtimeMounts).toBe(1);
	});

	it("multi-root: coverage for root A excludes stores from root B", async () => {
		const stores = [makeStoreMatch("$counter", "atom", "stores.ts")];
		const projectService = makeProjectService(stores);
		const eventStore = createLoggerEventStore(100);
		// Store from root B — should not appear in root A coverage
		eventStore.add(createEvent("change", "$other", 100, { projectRoot: "/root-b" }) as never);
		// Store from root A
		eventStore.add(createEvent("change", "$counter", 200, { projectRoot: "/root" }) as never);

		const service = createRuntimeAnalysisService(eventStore, projectService);
		const report = await service.getCoverageReport("/root");

		expect(report.runtimeStoreCount).toBe(1);
		expect(report.runtimeOnlyCount).toBe(0);
		expect(report.coveredCount).toBe(1);
		// $other from /root-b should not appear
		expect(report.stores.find(s => s.storeName === "$other")).toBeUndefined();
	});
});

describe("buildCoverageSummary", () => {
	it("renders coverage percentage and kind breakdown", () => {
		const summary = buildCoverageSummary({
			projectRoot: "/root",
			staticStoreCount: 4,
			runtimeStoreCount: 2,
			coveredCount: 2,
			staticOnlyCount: 2,
			runtimeOnlyCount: 0,
			coverageByKind: {
				atom: { total: 2, covered: 2 },
				computed: { total: 2, covered: 0 },
			},
			stores: [
				{ storeName: "$a", inStaticGraph: true, inRuntime: true, kind: "atom", file: "a.ts" },
				{ storeName: "$b", inStaticGraph: true, inRuntime: true, kind: "atom", file: "a.ts" },
				{ storeName: "$c", inStaticGraph: true, inRuntime: false, kind: "computed", file: "c.ts" },
				{ storeName: "$d", inStaticGraph: true, inRuntime: false, kind: "computed", file: "c.ts" },
			],
		});

		expect(summary).toContain("Covered: 2 (50%)");
		expect(summary).toContain("atom: 2/2 (100%)");
		expect(summary).toContain("computed: 0/2 (0%)");
		expect(summary).toContain("likely missing logger attachment");
		expect(summary).toContain("$c (computed, c.ts)");
		expect(summary).toContain("(none)");
	});

	it("renders runtime-only stores when present", () => {
		const summary = buildCoverageSummary({
			projectRoot: "/root",
			staticStoreCount: 1,
			runtimeStoreCount: 2,
			coveredCount: 1,
			staticOnlyCount: 0,
			runtimeOnlyCount: 1,
			coverageByKind: { atom: { total: 1, covered: 1 } },
			stores: [
				{ storeName: "$a", inStaticGraph: true, inRuntime: true, kind: "atom", file: "a.ts" },
				{ storeName: "$dynamic", inStaticGraph: false, inRuntime: true },
			],
		});

		expect(summary).toContain("Runtime-only (not in static graph):");
		expect(summary).toContain("$dynamic");
		expect(summary).not.toContain("(none)");
	});
});
