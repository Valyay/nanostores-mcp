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
				res.on("end", () =>
					resolve({ status: res.statusCode!, body: data, headers: res.headers }),
				);
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
