import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	realpathSafe,
	isPathInsideRoot,
	resolveSafePath,
	uriToFsPath,
	normalizeFsPath,
	isErrnoException,
} from "../../../src/config/security.ts";

let tmpRoot: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "security-test-"));
	// Create a nested directory structure
	fs.mkdirSync(path.join(tmpRoot, "sub", "deep"), { recursive: true });
	fs.writeFileSync(path.join(tmpRoot, "file.txt"), "hello");
	fs.writeFileSync(path.join(tmpRoot, "sub", "nested.txt"), "world");
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("normalizeFsPath", () => {
	it("resolves relative paths to absolute", () => {
		const result = normalizeFsPath("relative/path");
		expect(path.isAbsolute(result)).toBe(true);
	});

	it("resolves .. components", () => {
		const result = normalizeFsPath("/a/b/../c");
		expect(result).toBe("/a/c");
	});
});

describe("uriToFsPath", () => {
	it("converts file:// URI to fs path", () => {
		const result = uriToFsPath("file:///tmp/test.txt");
		expect(result).toBe("/tmp/test.txt");
	});

	it("passes through plain path", () => {
		const result = uriToFsPath("/tmp/test.txt");
		expect(result).toBe("/tmp/test.txt");
	});

	it("normalizes relative path", () => {
		const result = uriToFsPath("relative/path");
		expect(path.isAbsolute(result)).toBe(true);
	});

	it("decodes URI-encoded characters", () => {
		const result = uriToFsPath("file:///tmp/my%20file.txt");
		expect(result).toBe("/tmp/my file.txt");
	});
});

describe("realpathSafe", () => {
	it("resolves existing file to real path", () => {
		const result = realpathSafe(path.join(tmpRoot, "file.txt"));
		expect(result).toContain("file.txt");
		expect(fs.existsSync(result)).toBe(true);
	});

	it("resolves non-existent file by walking up to existing dir", () => {
		const result = realpathSafe(path.join(tmpRoot, "sub", "nonexistent.txt"));
		expect(result).toContain("nonexistent.txt");
		expect(result).toContain("sub");
	});

	it("resolves deeply non-existent path", () => {
		const result = realpathSafe(path.join(tmpRoot, "no", "such", "path.txt"));
		expect(path.isAbsolute(result)).toBe(true);
	});

	it("resolves root directory", () => {
		const result = realpathSafe(tmpRoot);
		expect(fs.existsSync(result)).toBe(true);
	});
});

describe("isPathInsideRoot", () => {
	it("returns true for path inside root", () => {
		expect(isPathInsideRoot(path.join(tmpRoot, "file.txt"), tmpRoot)).toBe(true);
	});

	it("returns true for nested path inside root", () => {
		expect(isPathInsideRoot(path.join(tmpRoot, "sub", "nested.txt"), tmpRoot)).toBe(true);
	});

	it("returns true when target equals root", () => {
		expect(isPathInsideRoot(tmpRoot, tmpRoot)).toBe(true);
	});

	it("returns false for path outside root", () => {
		expect(isPathInsideRoot("/tmp", tmpRoot)).toBe(false);
	});

	it("returns false for sibling directory", () => {
		const sibling = path.join(path.dirname(tmpRoot), "other-dir");
		expect(isPathInsideRoot(sibling, tmpRoot)).toBe(false);
	});

	it("returns false for ../traversal outside root", () => {
		const traversal = path.join(tmpRoot, "..", "etc", "passwd");
		expect(isPathInsideRoot(traversal, tmpRoot)).toBe(false);
	});
});

describe("resolveSafePath", () => {
	it("resolves path inside an allowed root", () => {
		const filePath = path.join(tmpRoot, "file.txt");
		const result = resolveSafePath(filePath, [tmpRoot]);
		expect(result).toContain("file.txt");
	});

	it("throws for path outside all roots", () => {
		expect(() => resolveSafePath("/etc/passwd", [tmpRoot])).toThrow("outside of allowed roots");
	});

	it("throws for ../traversal attempt", () => {
		const traversal = path.join(tmpRoot, "..", "etc", "passwd");
		expect(() => resolveSafePath(traversal, [tmpRoot])).toThrow("outside of allowed roots");
	});

	it("throws when no roots are configured", () => {
		expect(() => resolveSafePath("/any/path", [])).toThrow("No workspace roots configured");
	});

	it("checks multiple roots and accepts if in any", () => {
		const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "security-other-"));
		fs.writeFileSync(path.join(otherRoot, "test.txt"), "test");

		try {
			const result = resolveSafePath(path.join(otherRoot, "test.txt"), [tmpRoot, otherRoot]);
			expect(result).toContain("test.txt");
		} finally {
			fs.rmSync(otherRoot, { recursive: true, force: true });
		}
	});

	it("accepts file:// URI inside root", () => {
		const filePath = path.join(tmpRoot, "file.txt");
		const uri = `file://${filePath}`;
		const result = resolveSafePath(uri, [tmpRoot]);
		expect(result).toContain("file.txt");
	});
});

describe("isErrnoException", () => {
	it("returns true for ENOENT-style objects", () => {
		const err = { code: "ENOENT", message: "not found" };
		expect(isErrnoException(err)).toBe(true);
	});

	it("returns false for non-objects", () => {
		expect(isErrnoException(null)).toBe(false);
		expect(isErrnoException("error")).toBe(false);
		expect(isErrnoException(42)).toBe(false);
	});

	it("returns false for objects without code property", () => {
		expect(isErrnoException({ message: "error" })).toBe(false);
	});
});
