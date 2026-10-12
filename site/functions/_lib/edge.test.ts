import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadRelease, resolveLatest } from "./edge";

// In-memory Cache API + scripted GitHub, so the freshness and outage rules are tested without a network.
const store = new Map<string, Response>();
const fakeCache = {
	match: async (k: Request | string) => store.get(typeof k === "string" ? k : k.url)?.clone(),
	put: async (k: Request | string, v: Response) => void store.set(typeof k === "string" ? k : k.url, v.clone()),
};
const realFetch = globalThis.fetch;
let latest = "v1.2.0";
let down = false;
let calls = 0;
const manifest = (v: string) => ({ version: v, date: "2026-10-12T00:00:00+00:00", assets: { "aarch64-apple-darwin": { desktop_dmg: { url: `https://github.com/x/releases/download/v${v}/Atlas-${v}.dmg`, sha256: "bb", size: 2 } } } });

beforeEach(() => {
	store.clear();
	latest = "v1.2.0";
	down = false;
	calls = 0;
	(globalThis as unknown as { caches: unknown }).caches = { open: async () => fakeCache };
	globalThis.fetch = (async (url: string | URL | Request) => {
		calls++;
		if (down) throw new Error("GitHub is down");
		const u = String(url);
		if (u.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: `https://github.com/codeatlasdev/atlas/releases/tag/${latest}` } });
		const m = u.match(/download\/(v[^/]+)\/manifest\.json/);
		if (m) return Response.json(manifest(m[1].slice(1)));
		return new Response("nf", { status: 404 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("resolveLatest", () => {
	test("resolves the latest tag and loads what hangs off it", async () => {
		const r = await resolveLatest("release", loadRelease);
		expect(r.stale).toBe(false);
		expect(r.value.version).toBe("1.2.0");
	});
	test("a cached tag pointer is reused inside the TTL (no extra GitHub calls)", async () => {
		await resolveLatest("release", loadRelease);
		const before = calls;
		await resolveLatest("release", loadRelease);
		expect(calls).toBe(before);
	});
	test("?fresh skips the pointer: a new release shows immediately", async () => {
		await resolveLatest("release", loadRelease);
		latest = "v1.3.0";
		expect((await resolveLatest("release", loadRelease)).value.version).toBe("1.2.0");
		expect((await resolveLatest("release", loadRelease, true)).value.version).toBe("1.3.0");
	});
	test("GitHub down: serves the last good copy, flagged stale", async () => {
		await resolveLatest("release", loadRelease);
		store.delete("https://cache.invalid/tag");
		down = true;
		const r = await resolveLatest("release", loadRelease);
		expect(r.stale).toBe(true);
		expect(r.value.version).toBe("1.2.0");
	});
	test("GitHub down and nothing cached: the error surfaces (the page falls back to its built body)", async () => {
		down = true;
		await expect(resolveLatest("release", loadRelease)).rejects.toThrow();
	});
});
