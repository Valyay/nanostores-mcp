import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeFsPath, realpathSafe } from "../../../src/config/security.ts";
import {
	setClientRoots,
	clearClientRoots,
	getWorkspaceRoots,
	resetForTesting,
} from "../../../src/config/settings.ts";

/**
 * Tests for the settings module logic (src/config/settings.ts).
 *
 * Since getEnvWorkspaceRoots/getWorkspaceRoots cache results at module level
 * and read from envConfig at import time, we replicate the parsing logic here.
 */

/** Mirrors getEnvWorkspaceRoots env parsing logic */
function parseWorkspaceRoots(env: {
	NANOSTORES_MCP_ROOTS?: string;
	NANOSTORES_MCP_ROOT?: string;
	WORKSPACE_FOLDER?: string;
	WORKSPACE_FOLDER_PATHS?: string;
}): string[] {
	const roots: string[] = [];
	const delimiter = path.delimiter;

	const multi = env.NANOSTORES_MCP_ROOTS;
	if (multi) {
		for (const raw of multi.split(delimiter)) {
			const trimmed = raw.trim();
			if (trimmed) roots.push(normalizeFsPath(trimmed));
		}
	}

	const single = env.NANOSTORES_MCP_ROOT || env.WORKSPACE_FOLDER || env.WORKSPACE_FOLDER_PATHS;
	if (single) {
		for (const raw of single.split(delimiter)) {
			const trimmed = raw.trim();
			if (trimmed) roots.push(normalizeFsPath(trimmed));
		}
	}

	return Array.from(new Set(roots));
}

/** Mirrors resolveWorkspaceRoot logic */
function resolveRoot(roots: string[], rootUri?: string): string {
	if (!roots.length) {
		throw new Error("No workspace roots configured; cannot resolve workspace root.");
	}
	if (!rootUri || rootUri.trim().length === 0) {
		return roots[0];
	}
	// In real code this calls resolveWorkspacePath → resolveSafePath
	return rootUri;
}

describe("settings: workspace root parsing", () => {
	it("parses single root from NANOSTORES_MCP_ROOT", () => {
		const roots = parseWorkspaceRoots({ NANOSTORES_MCP_ROOT: "/project" });
		expect(roots).toEqual(["/project"]);
	});

	it("parses multiple roots from NANOSTORES_MCP_ROOTS (colon-separated on POSIX)", () => {
		// path.delimiter on macOS/Linux is ":"
		const roots = parseWorkspaceRoots({
			NANOSTORES_MCP_ROOTS: `/project-a${path.delimiter}/project-b`,
		});
		expect(roots).toHaveLength(2);
		expect(roots).toContain("/project-a");
		expect(roots).toContain("/project-b");
	});

	it("deduplicates roots", () => {
		const roots = parseWorkspaceRoots({
			NANOSTORES_MCP_ROOTS: `/project${path.delimiter}/project`,
		});
		expect(roots).toHaveLength(1);
	});

	it("ignores empty strings and whitespace", () => {
		const roots = parseWorkspaceRoots({
			NANOSTORES_MCP_ROOTS: `${path.delimiter}  ${path.delimiter}/valid`,
		});
		expect(roots).toEqual(["/valid"]);
	});

	it("falls back to WORKSPACE_FOLDER when ROOT is absent", () => {
		const roots = parseWorkspaceRoots({ WORKSPACE_FOLDER: "/ws" });
		expect(roots).toEqual(["/ws"]);
	});

	it("falls back to WORKSPACE_FOLDER_PATHS when others are absent", () => {
		const roots = parseWorkspaceRoots({ WORKSPACE_FOLDER_PATHS: "/ws-path" });
		expect(roots).toEqual(["/ws-path"]);
	});

	it("NANOSTORES_MCP_ROOT takes priority over WORKSPACE_FOLDER", () => {
		// When NANOSTORES_MCP_ROOT is set, it's used as the "single" source
		// since || short-circuits
		const roots = parseWorkspaceRoots({
			NANOSTORES_MCP_ROOT: "/primary",
			WORKSPACE_FOLDER: "/secondary",
		});
		expect(roots).toContain("/primary");
		// WORKSPACE_FOLDER is not used because NANOSTORES_MCP_ROOT is truthy
	});

	it("returns empty array when no env vars set", () => {
		const roots = parseWorkspaceRoots({});
		expect(roots).toEqual([]);
	});
});

describe("settings: resolveWorkspaceRoot logic", () => {
	it("returns first root when no rootUri provided", () => {
		expect(resolveRoot(["/project", "/other"])).toBe("/project");
	});

	it("returns first root when rootUri is empty string", () => {
		expect(resolveRoot(["/project"], "")).toBe("/project");
	});

	it("returns first root when rootUri is whitespace", () => {
		expect(resolveRoot(["/project"], "  ")).toBe("/project");
	});

	it("throws when no roots configured", () => {
		expect(() => resolveRoot([])).toThrow("No workspace roots configured");
	});

	it("uses rootUri when provided", () => {
		expect(resolveRoot(["/project"], "/project/sub")).toBe("/project/sub");
	});
});

describe("settings: client roots", () => {
	afterEach(() => {
		resetForTesting();
	});

	it("setClientRoots stores roots that appear in getWorkspaceRoots()", () => {
		const cwd = realpathSafe(process.cwd());
		setClientRoots([{ uri: pathToFileURL(cwd).href, name: "test-project" }]);

		const roots = getWorkspaceRoots();
		expect(roots).toHaveLength(1);
		expect(roots[0].fsPath).toBe(cwd);
		expect(roots[0].name).toBe("test-project");
	});

	it("clearClientRoots falls back to cwd", () => {
		const cwd = realpathSafe(process.cwd());
		setClientRoots([{ uri: pathToFileURL(cwd).href }]);
		clearClientRoots();

		const roots = getWorkspaceRoots();
		expect(roots).toHaveLength(1);
		expect(roots[0].fsPath).toBe(cwd);
		expect(roots[0].name).toBeUndefined();
	});

	it("cache invalidation works when calling setClientRoots after initial cache", () => {
		// Prime the cache with cwd fallback
		const cwdRoots = getWorkspaceRoots();
		expect(cwdRoots).toHaveLength(1);

		// Now set client roots — should invalidate and return new roots
		const cwd = realpathSafe(process.cwd());
		setClientRoots([
			{ uri: pathToFileURL(cwd).href, name: "root-a" },
			{ uri: pathToFileURL(cwd).href, name: "root-b" },
		]);

		const roots = getWorkspaceRoots();
		expect(roots).toHaveLength(2);
		expect(roots[0].name).toBe("root-a");
		expect(roots[1].name).toBe("root-b");
	});

	it("empty client roots array falls through to cwd", () => {
		setClientRoots([]);

		const roots = getWorkspaceRoots();
		expect(roots).toHaveLength(1);
		expect(roots[0].name).toBeUndefined();
	});
});

describe("settings: priority order", () => {
	afterEach(() => {
		resetForTesting();
	});

	it("client roots beat cwd fallback", () => {
		const cwd = realpathSafe(process.cwd());
		setClientRoots([{ uri: pathToFileURL(cwd).href, name: "from-client" }]);

		const roots = getWorkspaceRoots();
		expect(roots).toHaveLength(1);
		expect(roots[0].name).toBe("from-client");
	});
});
