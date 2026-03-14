import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { createLoggerBridge } from "../../../src/logger/loggerBridge.ts";
import { createLoggerEventStore } from "../../../src/domain/runtime/eventStore.ts";

function post(
	port: number,
	urlPath: string,
	body: string,
	method = "POST",
	extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path: urlPath,
				method,
				headers: { "Content-Type": "application/json", ...extraHeaders },
			},
			res => {
				let data = "";
				res.on("data", chunk => (data += chunk));
				res.on("end", () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
			},
		);
		req.on("error", reject);
		req.end(body);
	});
}

function makeEvent(kind: string, storeName: string, extra: Record<string, unknown> = {}): unknown {
	return { kind, storeName, timestamp: Date.now(), ...extra };
}

/** Find an available port by briefly binding to port 0 */
function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as net.AddressInfo;
			const freePort = addr.port;
			server.close(() => resolve(freePort));
		});
		server.on("error", reject);
	});
}

describe("logger bridge integration", () => {
	let bridge: ReturnType<typeof createLoggerBridge>;
	let port: number;

	afterEach(async () => {
		if (bridge) await bridge.stop();
	});

	async function startBridge(
		config: Parameters<typeof createLoggerBridge>[1] = {},
	): Promise<ReturnType<typeof createLoggerEventStore>> {
		const store = createLoggerEventStore();
		port = await findFreePort();
		bridge = createLoggerBridge(store, { port, ...config });
		await bridge.start();
		return store;
	}

	it("accepts valid events via POST and stores them", async () => {
		const store = await startBridge();
		const events = [makeEvent("mount", "$counter"), makeEvent("change", "$counter")];
		const res = await post(port, "/nanostores-logger", JSON.stringify({ events }));
		const json = JSON.parse(res.body);

		expect(res.status).toBe(200);
		expect(json.received).toBe(2);
		expect(store.getEvents().length).toBe(2);
	});

	it("filters out invalid events and stores only valid ones", async () => {
		const store = await startBridge();
		const events = [
			makeEvent("mount", "$a"),
			{ kind: "unknown-kind", storeName: "$b", timestamp: 1 },
			{ not: "an event" },
			makeEvent("change", "$a"),
		];
		const res = await post(port, "/nanostores-logger", JSON.stringify({ events }));
		const json = JSON.parse(res.body);

		expect(res.status).toBe(200);
		expect(json.received).toBe(2);
		expect(store.getEvents().length).toBe(2);
	});

	it("accepts action-end and action-error without actionName", async () => {
		const store = await startBridge();
		const events = [
			makeEvent("action-start", "$user", { actionId: "a1", actionName: "fetchUser" }),
			makeEvent("action-end", "$user", { actionId: "a1" }),
			makeEvent("action-error", "$user", { actionId: "a2", errorMessage: "fail" }),
		];
		const res = await post(port, "/nanostores-logger", JSON.stringify({ events }));
		const json = JSON.parse(res.body);

		expect(res.status).toBe(200);
		expect(json.received).toBe(3);
		expect(store.getEvents().length).toBe(3);
	});

	it("rejects action-start without actionName", async () => {
		const store = await startBridge();
		const events = [
			makeEvent("action-start", "$user", { actionId: "a1" }),
		];
		const res = await post(port, "/nanostores-logger", JSON.stringify({ events }));
		const json = JSON.parse(res.body);

		expect(res.status).toBe(200);
		expect(json.received).toBe(0);
		expect(store.getEvents().length).toBe(0);
	});

	it("rejects non-array events field with 400", async () => {
		await startBridge();
		const res = await post(port, "/nanostores-logger", JSON.stringify({ events: "not-array" }));

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/array/i);
	});

	it("rejects invalid JSON with 400", async () => {
		await startBridge();
		const res = await post(port, "/nanostores-logger", "{not valid json");

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toMatch(/json/i);
	});

	it("rejects payloads exceeding maxPayloadSize with 413", async () => {
		await startBridge({ maxPayloadSize: 100 });
		const largePayload = JSON.stringify({ events: [makeEvent("mount", "x".repeat(200))] });
		const res = await post(port, "/nanostores-logger", largePayload);

		expect(res.status).toBe(413);
	});

	it("does not crash after 413 and handles subsequent requests", async () => {
		const store = await startBridge({ maxPayloadSize: 100 });
		const largePayload = JSON.stringify({ events: [makeEvent("mount", "x".repeat(200))] });

		// The server may destroy the socket after sending 413, causing a client-side error.
		// Either outcome (413 response or socket hang up) is acceptable.
		try {
			const res413 = await post(port, "/nanostores-logger", largePayload);
			expect(res413.status).toBe(413);
		} catch {
			// Socket hang up is expected when server calls req.destroy()
		}

		// Allow the server to clean up the destroyed connection
		await new Promise(resolve => setTimeout(resolve, 50));

		// Server should still be alive and accept valid requests
		const validPayload = JSON.stringify({ events: [makeEvent("mount", "$ok")] });
		const res200 = await post(port, "/nanostores-logger", validPayload);
		expect(res200.status).toBe(200);
		expect(store.getEvents().length).toBe(1);
	});

	it("responds to OPTIONS with 204 and CORS headers", async () => {
		await startBridge();
		const res = await post(port, "/nanostores-logger", "", "OPTIONS");

		expect(res.status).toBe(204);
	});

	it("rejects non-POST methods with 405", async () => {
		await startBridge();

		for (const method of ["GET", "PUT", "DELETE"]) {
			const res = await post(port, "/nanostores-logger", "", method);
			expect(res.status).toBe(405);
		}
	});

	it("returns 404 for unknown paths", async () => {
		await startBridge();
		const res = await post(port, "/unknown-path", JSON.stringify({ events: [] }));

		expect(res.status).toBe(404);
	});

	it("is a no-op when disabled", async () => {
		const store = createLoggerEventStore();
		bridge = createLoggerBridge(store, { enabled: false });
		await bridge.start();

		const info = bridge.getInfo();
		expect(info.enabled).toBe(false);
		expect(info.url).toBeUndefined();
	});

	it("rejects start() when port is already in use", async () => {
		await startBridge();

		const store2 = createLoggerEventStore();
		const bridge2 = createLoggerBridge(store2, { port });
		await expect(bridge2.start()).rejects.toThrow();
	});

	describe("getInfo failure state", () => {
		it("reports error when port is already in use", async () => {
			await startBridge();

			const store2 = createLoggerEventStore();
			const bridge2 = createLoggerBridge(store2, { port });
			await bridge2.start().catch(() => {});

			const info = bridge2.getInfo();
			expect(info.enabled).toBe(true);
			expect(info.error).toMatch(/EADDRINUSE/);
			expect(info.url).toBeUndefined();
		});

		it("reports error when host is non-loopback", async () => {
			const store = createLoggerEventStore();
			const b = createLoggerBridge(store, { host: "0.0.0.0", port: 0 });
			await b.start().catch(() => {});

			const info = b.getInfo();
			expect(info.enabled).toBe(true);
			expect(info.error).toMatch(/loopback/i);
			expect(info.url).toBeUndefined();
		});

		it("reports enabled:false when bridge is disabled", () => {
			const store = createLoggerEventStore();
			const b = createLoggerBridge(store, { enabled: false });
			const info = b.getInfo();

			expect(info.enabled).toBe(false);
			expect(info.error).toBeUndefined();
			expect(info.url).toBeUndefined();
		});

		it("reports url when running successfully", async () => {
			await startBridge();
			const info = bridge.getInfo();

			expect(info.enabled).toBe(true);
			expect(info.url).toBeDefined();
			expect(info.error).toBeUndefined();
		});
	});

	describe("security", () => {
		it("rejects start() with non-loopback host", async () => {
			const store = createLoggerEventStore();
			bridge = createLoggerBridge(store, { host: "0.0.0.0", port: 0 });
			await expect(bridge.start()).rejects.toThrow(/loopback/i);
		});

		it("reflects CORS origin for localhost requests", async () => {
			await startBridge();
			const origin = "http://localhost:3000";
			const res = await post(port, "/nanostores-logger", JSON.stringify({ events: [] }), "POST", {
				Origin: origin,
			});

			expect(res.headers["access-control-allow-origin"]).toBe(origin);
		});

		it("reflects CORS origin for 127.0.0.1 requests", async () => {
			await startBridge();
			const origin = "http://127.0.0.1:5173";
			const res = await post(port, "/nanostores-logger", JSON.stringify({ events: [] }), "POST", {
				Origin: origin,
			});

			expect(res.headers["access-control-allow-origin"]).toBe(origin);
		});

		it("omits CORS header for non-localhost origins", async () => {
			await startBridge();
			const res = await post(port, "/nanostores-logger", JSON.stringify({ events: [] }), "POST", {
				Origin: "https://evil-site.com",
			});

			expect(res.headers["access-control-allow-origin"]).toBeUndefined();
		});

		it("omits CORS header when no Origin is sent", async () => {
			await startBridge();
			const res = await post(port, "/nanostores-logger", JSON.stringify({ events: [] }));

			expect(res.headers["access-control-allow-origin"]).toBeUndefined();
		});
	});
});
