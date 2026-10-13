import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// The Pages handlers are typed by @cloudflare/workers-types (main functions project); this bun-typed project loads them by path.
const load = async (file: string) => ((await import(file)) as { onRequestGet: unknown }).onRequestGet;
const [changelogJson, channelsJson, releaseJson] = await Promise.all([load("./changelog.json.ts"), load("./channels.json.ts"), load("./release.json.ts")]);

// The endpoints end to end over an in-memory Cache API and scripted GitHub.
const store = new Map<string, Response>();
const fakeCache = {
	match: async (k: Request | string) => store.get(typeof k === "string" ? k : k.url)?.clone(),
	put: async (k: Request | string, v: Response) => void store.set(typeof k === "string" ? k : k.url, v.clone()),
};
const realFetch = globalThis.fetch;
const manifest = (v: string) => ({ version: v, date: "2026-10-12T00:00:00+00:00", assets: { "aarch64-apple-darwin": { desktop_dmg: { url: `https://github.com/x/releases/download/v${v}/Atlas-${v}.dmg`, sha256: "bb", size: 2 } } } });
const feed = ["v1.4.0-beta.1", "v1.3.0"];

beforeEach(() => {
	store.clear();
	(globalThis as unknown as { caches: unknown }).caches = { open: async () => fakeCache };
	globalThis.fetch = (async (url: string | URL | Request) => {
		const u = String(url);
		if (u.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: "https://github.com/codeatlasdev/atlas/releases/tag/v1.3.0" } });
		if (u.endsWith("/releases.atom")) return new Response(`<feed>${feed.map((t) => `<entry><link rel="alternate" href="https://github.com/codeatlasdev/atlas/releases/tag/${t}"/></entry>`).join("")}</feed>`);
		const m = u.match(/download\/(v[^/]+)\/manifest\.json/);
		if (m) return Response.json(manifest(m[1].slice(1)));
		const c = u.match(/atlas\/(v[^/]+)\/CHANGELOG\.md/);
		if (c) return new Response(c[1] === "v1.4.0-beta.1" ? "# C\n\n## [1.4.0-beta.1] — 2026-10-20\n\n- b\n\n## [1.3.0] — 2026-10-12\n\n- s\n" : "# C\n\n## [1.3.0] — 2026-10-12\n\n- s\n");
		return new Response("nf", { status: 404 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

type Handler = (ctx: { request: Request }) => Promise<Response>;
const call = (h: unknown, path: string) => (h as Handler)({ request: new Request(`https://x.test${path}`) });

describe("GET /release.json", () => {
	test("defaults to the default channel (alpha pre-GA): the newest build it accepts, and says which channel and whether it is a prerelease", async () => {
		const body = await (await call(releaseJson, "/release.json")).json();
		expect(body).toMatchObject({ version: "1.4.0-beta.1", tag: "v1.4.0-beta.1", channel: "alpha", prerelease: true });
		expect(body.dmg.sha256).toBe("bb");
	});
	test("?channel=stable is still selectable and never a prerelease", async () => {
		const body = await (await call(releaseJson, "/release.json?channel=stable")).json();
		expect(body).toMatchObject({ version: "1.3.0", tag: "v1.3.0", channel: "stable", prerelease: false });
	});
	test("no channel asked and nothing newer than stable: the default channel serves stable's release (never an empty download)", async () => {
		feed.splice(0, feed.length, "v1.3.0");
		const body = await (await call(releaseJson, "/release.json")).json();
		expect(body).toMatchObject({ version: "1.3.0", channel: "alpha", prerelease: false });
		feed.splice(0, feed.length, "v1.4.0-beta.1", "v1.3.0");
	});
	test("?channel=beta follows the newest beta", async () => {
		expect(await (await call(releaseJson, "/release.json?channel=beta")).json()).toMatchObject({ version: "1.4.0-beta.1", channel: "beta", prerelease: true });
	});
	test("?channel=alpha resolves to the newest build it accepts (here the beta, nothing newer exists)", async () => {
		expect(await (await call(releaseJson, "/release.json?channel=alpha")).json()).toMatchObject({ channel: "alpha", version: "1.4.0-beta.1" });
	});
	test("an unknown channel is a 400 that lists the valid names", async () => {
		for (const q of ["nightly", "Beta", ""]) {
			const res = await call(releaseJson, `/release.json?channel=${q}`);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: "invalid_channel", valid: ["stable", "beta", "alpha"] });
			expect(res.headers.get("cache-control")).toBe("no-store");
		}
	});
});

describe("GET /channels.json", () => {
	test("the shared copy plus what each channel offers, in one answer", async () => {
		const res = await call(channelsJson, "/channels.json");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.stage).toBe("alpha");
		expect(body.stage_note).toContain("alpha");
		expect(body.channels.map((c: { id: string; release: { version: string } | null }) => [c.id, c.release?.version])).toEqual([["stable", "1.3.0"], ["beta", "1.4.0-beta.1"], ["alpha", "1.4.0-beta.1"]]);
		expect(body.channels[1]).toMatchObject({ label: "Beta", risk: "medium" });
		expect(body.channels[1].promise).toContain("Feature-complete");
	});
	test("with only a stable release, every channel offers it (a channel is never worse than stable)", async () => {
		feed.splice(0, feed.length, "v1.3.0");
		const body = await (await call(channelsJson, "/channels.json")).json();
		expect(body.channels.map((c: { release: { version: string } }) => c.release?.version)).toEqual(["1.3.0", "1.3.0", "1.3.0"]);
		feed.splice(0, feed.length, "v1.4.0-beta.1", "v1.3.0");
	});
	test("GitHub unreachable and nothing cached: 502 JSON", async () => {
		globalThis.fetch = (async () => {
			throw new Error("down");
		}) as unknown as typeof fetch;
		const res = await call(channelsJson, "/channels.json");
		expect(res.status).toBe(502);
		expect((await res.json()).error).toBe("channels_unavailable");
	});
});

describe("GET /changelog.json", () => {
	test("default channel is the default (alpha pre-GA): the history at its newest tag, with per-entry kind", async () => {
		const body = await (await call(changelogJson, "/changelog.json")).json();
		expect(body.tag).toBe("v1.4.0-beta.1");
		expect(body.entries.map((e: { version: string }) => e.version)).toEqual(["1.4.0-beta.1", "1.3.0"]);
	});
	test("?channel=stable keeps the stable history (unchanged shape plus per-entry kind)", async () => {
		const body = await (await call(changelogJson, "/changelog.json?channel=stable")).json();
		expect(body.tag).toBe("v1.3.0");
		expect(body.entries.map((e: { version: string }) => e.version)).toEqual(["1.3.0"]);
		expect(body.entries[0]).toMatchObject({ kind: "stable", superseded: false });
	});
	test("?channel=beta shows the history at the beta's newest tag, with prerelease kinds", async () => {
		const body = await (await call(changelogJson, "/changelog.json?channel=beta")).json();
		expect(body.tag).toBe("v1.4.0-beta.1");
		expect(body.entries.map((e: { version: string; kind: string }) => [e.version, e.kind])).toEqual([["1.4.0-beta.1", "beta"], ["1.3.0", "stable"]]);
	});
	test("an unknown channel is a 400", async () => {
		expect((await call(changelogJson, "/changelog.json?channel=x")).status).toBe(400);
	});
});
