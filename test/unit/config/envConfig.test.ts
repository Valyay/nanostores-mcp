import { describe, expect, it } from "vitest";
import { EnvSchema } from "../../../src/config/envConfig.ts";

function parseEnv(
	overrides: Record<string, string | undefined> = {},
): ReturnType<typeof EnvSchema.parse> {
	return EnvSchema.parse(overrides);
}

describe("config/envConfig", () => {
	describe("NANOSTORES_MCP_LOGGER_ENABLED", () => {
		it('transforms "true" and "1" to true', () => {
			expect(
				parseEnv({ NANOSTORES_MCP_LOGGER_ENABLED: "true" }).NANOSTORES_MCP_LOGGER_ENABLED,
			).toBe(true);
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_ENABLED: "1" }).NANOSTORES_MCP_LOGGER_ENABLED).toBe(
				true,
			);
		});

		it("transforms other values to false", () => {
			expect(
				parseEnv({ NANOSTORES_MCP_LOGGER_ENABLED: "false" }).NANOSTORES_MCP_LOGGER_ENABLED,
			).toBe(false);
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_ENABLED: "0" }).NANOSTORES_MCP_LOGGER_ENABLED).toBe(
				false,
			);
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_ENABLED: "yes" }).NANOSTORES_MCP_LOGGER_ENABLED).toBe(
				false,
			);
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_ENABLED: "" }).NANOSTORES_MCP_LOGGER_ENABLED).toBe(
				false,
			);
		});

		it("defaults to false when absent", () => {
			expect(parseEnv({}).NANOSTORES_MCP_LOGGER_ENABLED).toBe(false);
		});
	});

	describe("NANOSTORES_MCP_LOGGER_PORT", () => {
		it("parses valid port numbers", () => {
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_PORT: "3999" }).NANOSTORES_MCP_LOGGER_PORT).toBe(
				3999,
			);
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_PORT: "0" }).NANOSTORES_MCP_LOGGER_PORT).toBe(0);
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_PORT: "65535" }).NANOSTORES_MCP_LOGGER_PORT).toBe(
				65535,
			);
		});

		it("defaults to 3999 when absent", () => {
			expect(parseEnv({}).NANOSTORES_MCP_LOGGER_PORT).toBe(3999);
		});

		it("rejects non-numeric port strings", () => {
			expect(() => parseEnv({ NANOSTORES_MCP_LOGGER_PORT: "abc" })).toThrow();
		});

		it("rejects negative ports", () => {
			expect(() => parseEnv({ NANOSTORES_MCP_LOGGER_PORT: "-1" })).toThrow();
		});

		it("rejects ports above 65535", () => {
			expect(() => parseEnv({ NANOSTORES_MCP_LOGGER_PORT: "70000" })).toThrow();
		});
	});

	describe("NANOSTORES_MCP_LOGGER_HOST", () => {
		it("defaults to 127.0.0.1", () => {
			expect(parseEnv({}).NANOSTORES_MCP_LOGGER_HOST).toBe("127.0.0.1");
		});

		it("accepts custom host", () => {
			expect(parseEnv({ NANOSTORES_MCP_LOGGER_HOST: "0.0.0.0" }).NANOSTORES_MCP_LOGGER_HOST).toBe(
				"0.0.0.0",
			);
		});
	});

	describe("NANOSTORES_DOCS_PATTERNS", () => {
		it("splits comma-separated patterns and trims spaces", () => {
			expect(
				parseEnv({ NANOSTORES_DOCS_PATTERNS: "*.md, *.mdx" }).NANOSTORES_DOCS_PATTERNS,
			).toEqual(["*.md", "*.mdx"]);
		});

		it("handles single pattern without comma", () => {
			expect(parseEnv({ NANOSTORES_DOCS_PATTERNS: "**/*.md" }).NANOSTORES_DOCS_PATTERNS).toEqual([
				"**/*.md",
			]);
		});

		it("returns undefined when absent", () => {
			expect(parseEnv({}).NANOSTORES_DOCS_PATTERNS).toBeUndefined();
		});

		it("returns undefined for empty string", () => {
			expect(parseEnv({ NANOSTORES_DOCS_PATTERNS: "" }).NANOSTORES_DOCS_PATTERNS).toBeUndefined();
		});

		it("preserves empty segments from trailing commas", () => {
			const result = parseEnv({ NANOSTORES_DOCS_PATTERNS: "a.md,b.md," }).NANOSTORES_DOCS_PATTERNS;
			expect(result).toEqual(["a.md", "b.md", ""]);
		});
	});
});
