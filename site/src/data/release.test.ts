// @ts-nocheck bun test runtime types are not part of the site tsconfig
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CHANNEL } from "../../functions/_lib/channels";
import { channelReleases, latestRelease } from "./release";

// /download is built from GitHub: the primary button is the DEFAULT channel's release (alpha pre-GA), the cards below it are the
// other channels. Scripted GitHub: stable is v1.4.0, the feed also has a newer alpha and a beta.
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const manifest = (v: string) => ({ version: v, date: "2026-10-13T00:00:00+00:00", assets: { "aarch64-apple-darwin": { desktop_dmg: { url: `https://github.com/x/releases/download/v${v}/Atlas-${v}.dmg`, sha256: "bb", size: 2 }, cli: { url: `https://github.com/x/releases/download/v${v}/atlas-${v}.tar.gz`, sha256: "cc", size: 1 } } } });
const script = (feed: string[], stable = "v1.4.0", unpublished: string[] = []) => {
	globalThis.fetch = (async (url: string | URL | Request) => {
		const u = String(url);
		if (u.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: `https://github.com/codeatlasdev/atlas/releases/tag/${stable}` } });
		if (u.endsWith("/releases.atom")) return new Response(`<feed>${feed.map((t) => `<entry><link rel="alternate" href="https://github.com/codeatlasdev/atlas/releases/tag/${t}"/></entry>`).join("")}</feed>`);
		const m = u.match(/download\/(v[^/]+)\/manifest\.json/);
		if (m && !unpublished.includes(m[1])) return Response.json(manifest(m[1].slice(1)));
		return new Response("nf", { status: 404 });
	}) as typeof fetch;
};

describe("the download page's primary release", () => {
	test("is the default channel's newest build, not the latest stable", async () => {
		script(["v1.5.0-alpha.2", "v1.5.0-alpha.1", "v1.4.0-beta.1", "v1.4.0"]);
		const rel = await latestRelease();
		expect(DEFAULT_CHANNEL).toBe("alpha");
		expect(rel).toMatchObject({ resolved: true, version: "1.5.0-alpha.2", tag: "v1.5.0-alpha.2" });
		expect(rel.dmg?.url).toContain("Atlas-1.5.0-alpha.2.dmg");
	});
	test("when no alpha is newer than stable it is the stable release (the button is never empty)", async () => {
		script(["v1.4.0-beta.1", "v1.4.0"]);
		expect(await latestRelease()).toMatchObject({ resolved: true, version: "1.4.0" });
	});
	test("a pushed tag whose release is not published yet is skipped", async () => {
		script(["v1.5.0-alpha.2", "v1.5.0-alpha.1", "v1.4.0"], "v1.4.0", ["v1.5.0-alpha.2"]);
		expect(await latestRelease()).toMatchObject({ version: "1.5.0-alpha.1" });
	});
	test("GitHub unreachable: the built page falls back to the releases page", async () => {
		globalThis.fetch = (async () => {
			throw new Error("down");
		}) as unknown as typeof fetch;
		expect(await latestRelease()).toMatchObject({ resolved: false, version: "" });
	});
});

describe("the other channels on the download page", () => {
	test("are every channel but the default: Stable is a card now, Beta and Alpha's duplicate is gone", async () => {
		script(["v1.5.0-alpha.2", "v1.5.0-beta.1", "v1.4.0"]);
		const others = await channelReleases();
		expect(Object.keys(others).sort()).toEqual(["beta", "stable"]);
		expect(others.stable).toMatchObject({ version: "1.4.0" });
		expect(others.beta).toMatchObject({ version: "1.5.0-beta.1" });
	});
	test("Beta with nothing newer than stable is null (the card says 'No Beta release yet'); Stable is always its own release", async () => {
		script(["v1.4.0"]);
		const others = await channelReleases();
		expect(others.beta).toBeNull();
		expect(others.stable).toMatchObject({ version: "1.4.0" });
	});
	test("GitHub unreachable: every card is null and the page keeps its empty states", async () => {
		globalThis.fetch = (async () => {
			throw new Error("down");
		}) as unknown as typeof fetch;
		expect(await channelReleases()).toEqual({ stable: null, beta: null });
	});
});
