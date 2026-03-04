import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { ProgressCallback } from "../../domain/project/types.js";

/**
 * Creates a ProgressCallback that sends MCP progress notifications
 * when the client provided a progressToken in _meta.
 * Returns undefined if the client did not request progress.
 */
export function createMcpProgressCallback(
	extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): ProgressCallback | undefined {
	const token = extra._meta?.progressToken;
	if (token == null) return undefined;

	return (progress: number, total: number, message: string): void => {
		void extra.sendNotification({
			method: "notifications/progress",
			params: { progressToken: token, progress, total, message },
		});
	};
}
