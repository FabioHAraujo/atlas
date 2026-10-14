import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadChangelog, loadRelease, resolveChannel, resolveChannels, resolveLatest } from "./edge";

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
let feed: string[] = [];
// `releases.atom?after=<tag>` pages: the entries older than <tag>.
let pages: Record<string, string[]> = {};
let unpublished = new Set<string>();
const atom = (tags: string[]) => `<feed><link rel="alternate" href="https://github.com/codeatlasdev/atlas/releases"/>${tags.map((t) => `<entry><link rel="alternate" type="text/html" href="https://github.com/codeatlasdev/atlas/releases/tag/${encodeURIComponent(t)}"/></entry>`).join("")}</feed>`;
const manifest = (v: string) => ({ version: v, date: "2026-10-12T00:00:00+00:00", assets: { "aarch64-apple-darwin": { desktop_dmg: { url: `https://github.com/x/releases/download/v${v}/Atlas-${v}.dmg`, sha256: "bb", size: 2 } } } });

beforeEach(() => {
	store.clear();
	latest = "v1.2.0";
	down = false;
	calls = 0;
	feed = [];
	pages = {};
	unpublished = new Set();
	(globalThis as unknown as { caches: unknown }).caches = { open: async () => fakeCache };
	globalThis.fetch = (async (url: string | URL | Request) => {
		calls++;
		if (down) throw new Error("GitHub is down");
		const u = String(url);
		if (u.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: `https://github.com/codeatlasdev/atlas/releases/tag/${latest}` } });
		if (u.endsWith("/releases.atom")) return new Response(atom(feed), { headers: { "content-type": "application/atom+xml" } });
		const after = u.match(/\/releases\.atom\?after=([^&]+)$/)?.[1];
		if (after) return new Response(atom(pages[decodeURIComponent(after)] ?? []), { headers: { "content-type": "application/atom+xml" } });
		const m = u.match(/download\/(v[^/]+)\/manifest\.json/);
		if (m) return unpublished.has(m[1]) ? new Response("nf", { status: 404 }) : Response.json(manifest(m[1].slice(1)));
		const c = u.match(/githubusercontent\.com\/codeatlasdev\/atlas\/(v[^/]+)\/CHANGELOG\.md/);
		if (c) return new Response(`# Changelog at ${c[1]}`);
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

describe("resolveChannel", () => {
	test("stable never trusts the redirect alone: with a real stable redirect the feed is read once and paging is not needed", async () => {
		feed = ["v1.4.0-beta.1", "v1.3.0"];
		latest = "v1.3.0";
		const urls: string[] = [];
		const inner = globalThis.fetch;
		globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => (urls.push(String(u)), inner(u, i))) as typeof fetch;
		const r = await resolveChannel("release", "stable", loadRelease);
		expect(r.value?.version).toBe("1.3.0");
		expect(urls.filter((u) => u.includes("releases.atom"))).toEqual(["https://github.com/codeatlasdev/atlas/releases.atom"]);
	});
	test("beta follows the newest beta/rc, alpha the newest of everything, stable never a prerelease", async () => {
		feed = ["v1.5.0-alpha.2", "v1.4.0-beta.2", "v1.4.0-beta.1", "v1.3.0"];
		latest = "v1.3.0";
		const got = await Promise.all((["stable", "beta", "alpha"] as const).map(async (c) => (await resolveChannel("release", c, loadRelease)).value?.version));
		expect(got).toEqual(["1.3.0", "1.4.0-beta.2", "1.5.0-alpha.2"]);
	});
	test("a tag pushed before its release is published is skipped: the channel walks down to the newest published one", async () => {
		feed = ["v1.5.0-alpha.2", "v1.5.0-alpha.1", "v1.3.0"];
		unpublished = new Set(["v1.5.0-alpha.2"]);
		expect((await resolveChannel("release", "alpha", loadRelease)).value?.version).toBe("1.5.0-alpha.1");
	});
	test("nothing published above stable: the channel falls back to stable", async () => {
		feed = ["v1.5.0-alpha.1", "v1.3.0"];
		latest = "v1.3.0";
		unpublished = new Set(["v1.5.0-alpha.1"]);
		expect((await resolveChannel("release", "alpha", loadRelease)).value?.version).toBe("1.3.0");
	});
	test("the feed is cached inside the TTL, ?fresh asks again", async () => {
		feed = ["v1.4.0-beta.1", "v1.3.0"];
		latest = "v1.3.0";
		await resolveChannel("release", "beta", loadRelease);
		feed = ["v1.4.0-beta.2", "v1.4.0-beta.1", "v1.3.0"];
		expect((await resolveChannel("release", "beta", loadRelease)).value?.version).toBe("1.4.0-beta.1");
		expect((await resolveChannel("release", "beta", loadRelease, true)).value?.version).toBe("1.4.0-beta.2");
	});
	test("feed unreachable: beta/alpha degrade to stable instead of failing", async () => {
		latest = "v1.3.0";
		const inner = globalThis.fetch;
		globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => (String(u).endsWith("releases.atom") ? Promise.reject(new Error("feed down")) : inner(u, i))) as typeof fetch;
		expect((await resolveChannel("release", "alpha", loadRelease)).value?.version).toBe("1.3.0");
	});
	test("GitHub down: the last good copy of that channel is served, flagged stale", async () => {
		feed = ["v1.4.0-beta.1", "v1.3.0"];
		latest = "v1.3.0";
		await resolveChannel("release", "beta", loadRelease);
		store.delete("https://cache.invalid/tag");
		store.delete("https://cache.invalid/feed");
		down = true;
		const r = await resolveChannel("release", "beta", loadRelease);
		expect([r.stale, r.value?.version]).toEqual([true, "1.4.0-beta.1"]);
	});
	test("a channel's last-good copy is not another channel's", async () => {
		feed = ["v1.4.0-beta.1", "v1.3.0"];
		latest = "v1.3.0";
		await resolveChannel("release", "beta", loadRelease);
		store.delete("https://cache.invalid/tag");
		store.delete("https://cache.invalid/feed");
		down = true;
		await expect(resolveChannel("release", "alpha", loadRelease)).rejects.toThrow();
	});
	test("the changelog of a channel is the CHANGELOG.md at that channel's newest tag", async () => {
		feed = ["v1.4.0-beta.1", "v1.3.0"];
		latest = "v1.3.0";
		expect((await resolveChannel("changelog", "beta", loadChangelog)).value?.tag).toBe("v1.4.0-beta.1");
		expect((await resolveChannel("changelog", "stable", loadChangelog)).value?.tag).toBe("v1.3.0");
	});
});

describe("resolveChannels", () => {
	test("all three channels from one feed fetch, empty channels are null", async () => {
		feed = ["v1.5.0-alpha.1", "v1.4.0-beta.1"];
		latest = "v1.3.0";
		unpublished = new Set(["v1.5.0-alpha.1"]);
		let feeds = 0;
		const inner = globalThis.fetch;
		globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => (String(u).endsWith("releases.atom") && feeds++, inner(u, i))) as typeof fetch;
		const r = await resolveChannels("release", loadRelease);
		expect(r.value).toEqual({ stable: expect.objectContaining({ version: "1.3.0" }), beta: expect.objectContaining({ version: "1.4.0-beta.1" }), alpha: expect.objectContaining({ version: "1.4.0-beta.1" }) });
		expect(feeds).toBe(1);
	});
	test("stable redirect unavailable and nothing cached: the error surfaces, like /release.json", async () => {
		const inner = globalThis.fetch;
		globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => (String(u).endsWith("/releases/latest") ? Promise.resolve(new Response(null, { status: 404 })) : inner(u, i))) as typeof fetch;
		await expect(resolveChannels("release", loadRelease)).rejects.toThrow();
	});
});

// Incident guard: while the default channel is alpha, release.yml publishes alphas as non-prerelease, so
// `releases/latest` points at the newest alpha. Stable must still be the newest tag without a prerelease label.
describe("stable while /releases/latest is an alpha", () => {
	test("resolveChannel(stable) is the newest real stable from the feed, never the redirect's alpha", async () => {
		latest = "v1.5.0-alpha.4";
		feed = ["v1.5.0-alpha.4", "v1.5.0-alpha.3", "v1.4.0", "v1.4.0-beta.1"];
		expect((await resolveChannel("release", "stable", loadRelease)).value?.version).toBe("1.4.0");
	});
	test("resolveLatest (the pages' stable path) follows the same rule", async () => {
		latest = "v1.5.0-alpha.4";
		feed = ["v1.5.0-alpha.4", "v1.4.0"];
		expect((await resolveLatest("release", loadRelease)).value.version).toBe("1.4.0");
	});
	test("alpha and beta are unaffected; resolveChannels agrees", async () => {
		latest = "v1.5.0-alpha.4";
		feed = ["v1.5.0-alpha.4", "v1.4.0-beta.1", "v1.4.0"];
		const r = await resolveChannels("release", loadRelease);
		expect([r.value.stable?.version, r.value.beta?.version, r.value.alpha?.version]).toEqual(["1.4.0", "1.4.0", "1.5.0-alpha.4"]);
	});
	test("a window of alphas hides the stable: the feed is paged back with ?after= until a stable shows up", async () => {
		latest = "v1.5.0-alpha.12";
		const page1 = Array.from({ length: 10 }, (_, i) => `v1.5.0-alpha.${12 - i}`); // alpha.12 .. alpha.3
		const page2 = ["v1.5.0-alpha.2", "v1.5.0-alpha.1", "v1.4.0"];
		feed = page1;
		pages = { "v1.5.0-alpha.3": page2 };
		expect((await resolveChannel("release", "stable", loadRelease)).value?.version).toBe("1.4.0");
	});
	test("paging is bounded: no stable anywhere ends in an error, not a loop", async () => {
		latest = "v1.9.0-alpha.99";
		feed = Array.from({ length: 10 }, (_, i) => `v1.9.0-alpha.${99 - i}`);
		pages = new Proxy({}, { get: (_t, after: string) => Array.from({ length: 10 }, (_, i) => `${after.slice(0, -2)}${Number(after.split(".").pop()) - 1 - i}`) }) as never;
		await expect(resolveChannel("release", "stable", loadRelease)).rejects.toThrow();
		expect(calls).toBeLessThan(40);
	});
	test("redirect is a real stable (GA behaviour): used even when the feed is unreachable", async () => {
		latest = "v1.4.0";
		const inner = globalThis.fetch;
		globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => (String(u).includes("releases.atom") ? Promise.reject(new Error("feed down")) : inner(u, i))) as typeof fetch;
		expect((await resolveChannel("release", "stable", loadRelease)).value?.version).toBe("1.4.0");
	});
});
