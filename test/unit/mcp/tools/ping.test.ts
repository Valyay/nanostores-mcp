import { describe, expect, it } from "vitest";
import { buildLoggerBridgeStatusText } from "../../../../src/mcp/tools/ping.ts";

describe("ping tool: logger bridge status text", () => {
	it("returns empty string when no loggerInfo provided", () => {
		expect(buildLoggerBridgeStatusText(undefined)).toBe("");
	});

	it('shows "disabled" when bridge is disabled', () => {
		const text = buildLoggerBridgeStatusText({ enabled: false });

		expect(text).toContain("Logger Bridge: disabled");
		expect(text).not.toContain("starting");
	});

	it('shows "enabled" with URL when bridge is running', () => {
		const text = buildLoggerBridgeStatusText({
			enabled: true,
			url: "http://127.0.0.1:3999",
		});

		expect(text).toContain("Logger Bridge: enabled");
		expect(text).toContain("http://127.0.0.1:3999");
	});

	it('shows "enabled (starting...)" when enabled but not yet listening', () => {
		const text = buildLoggerBridgeStatusText({ enabled: true });

		expect(text).toContain("Logger Bridge: enabled (starting...)");
	});

	it('shows "enabled but not running" with error when start failed', () => {
		const text = buildLoggerBridgeStatusText({
			enabled: true,
			error: "EADDRINUSE",
		});

		expect(text).toContain("Logger Bridge: enabled but not running");
		expect(text).toContain("EADDRINUSE");
	});
});
