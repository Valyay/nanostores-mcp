import { describe, expect, it, vi } from "vitest";
import { createMcpProgressCallback } from "../../../../src/mcp/shared/progress.ts";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";

function createMockExtra(
	progressToken?: string | number,
): RequestHandlerExtra<ServerRequest, ServerNotification> {
	return {
		signal: new AbortController().signal,
		requestId: "req-1",
		sendNotification: vi.fn().mockResolvedValue(undefined),
		sendRequest: vi.fn(),
		_meta: progressToken != null ? { progressToken } : undefined,
	} as unknown as RequestHandlerExtra<ServerRequest, ServerNotification>;
}

describe("createMcpProgressCallback", () => {
	it("returns undefined when no progressToken in _meta", () => {
		const extra = createMockExtra();
		expect(createMcpProgressCallback(extra)).toBeUndefined();
	});

	it("returns undefined when _meta is undefined", () => {
		const extra = createMockExtra();
		extra._meta = undefined;
		expect(createMcpProgressCallback(extra)).toBeUndefined();
	});

	it("returns a callback when progressToken is a string", () => {
		const extra = createMockExtra("tok-123");
		const cb = createMcpProgressCallback(extra);
		expect(cb).toBeTypeOf("function");
	});

	it("returns a callback when progressToken is a number", () => {
		const extra = createMockExtra(42);
		const cb = createMcpProgressCallback(extra);
		expect(cb).toBeTypeOf("function");
	});

	it("callback sends notification with correct shape", () => {
		const extra = createMockExtra("tok-abc");
		const cb = createMcpProgressCallback(extra)!;

		cb(2, 4, "Analyzing AST");

		expect(extra.sendNotification).toHaveBeenCalledOnce();
		expect(extra.sendNotification).toHaveBeenCalledWith({
			method: "notifications/progress",
			params: {
				progressToken: "tok-abc",
				progress: 2,
				total: 4,
				message: "Analyzing AST",
			},
		});
	});

	it("callback fires-and-forgets (does not await sendNotification)", () => {
		const extra = createMockExtra("tok-1");
		const cb = createMcpProgressCallback(extra)!;

		// Should not throw even if sendNotification returns a promise
		expect(() => cb(0, 1, "start")).not.toThrow();
	});
});
