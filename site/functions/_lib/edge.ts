// The release engine: the site never has a copy of "the latest release", it asks GitHub at the edge.
//
//   latest tag      github.com/<repo>/releases/latest redirect (no API quota, no token)
//   beta/alpha      github.com/<repo>/releases.atom (10 newest published, no API) + the stable tag, resolved by ./channels.ts;
//                   a candidate counts only once its manifest.json exists (the tag is pushed before the release is built)
//   changelog       raw.githubusercontent.com/<repo>/<tag>/CHANGELOG.md   (pinned to the tag: never a half-written main)
//   assets          github.com/<repo>/releases/download/<tag>/manifest.json (version, date, sha256, size per asset)
//
// Freshness: the tag lookup is cached for TAG_TTL seconds (a new release shows within ~1 minute); everything that
// hangs off a tag is immutable and cached per tag. If GitHub is down or slow we serve the last good copy (the Cache
// API entry is kept for a day past its TTL) instead of failing, so the page is never empty and never old by choice.

import { CHANNELS, atomTags, resolve, type Channel } from "./channels";
import { REPO, toRelease, type Manifest, type ReleaseInfo } from "./release";

export const TAG_TTL = 60;
const KEEP = 86400 * 7;
const TIMEOUT = 8000;

const get = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), headers: { "user-agent": "atlas-site-edge" } });

/** Latest published tag from the redirect of /releases/latest. Throws on anything unexpected. */
export async function latestTag(): Promise<string> {
	const res = await get(`https://github.com/${REPO}/releases/latest`, { method: "HEAD", redirect: "manual" });
	const tag = res.headers.get("location")?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
	if (!tag || !/^v?[0-9A-Za-z._-]+$/.test(tag)) throw new Error(`no latest tag (HTTP ${res.status})`);
	return tag;
}

/** Tag-pinned bodies never change: cache them hard, serve stale on failure. */
async function cachedByTag<T>(cache: Cache, key: string, load: () => Promise<T>): Promise<T> {
	const hit = await cache.match(key);
	if (hit) return (await hit.json()) as T;
	const value = await load();
	await cache.put(key, new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${KEEP}` } }));
	return value;
}

const CACHE = "atlas-release-v1";

export interface Resolved<T> {
	value: T;
	/** true when GitHub could not be reached and the last good copy was served */
	stale: boolean;
}

/** Short-TTL pointer (a new release shows within a minute): cached `load()` unless `fresh`. */
async function pointer(cache: Cache, name: string, load: () => Promise<string>, fresh: boolean): Promise<string> {
	const key = new Request(`https://cache.invalid/${name}`);
	const hit = fresh ? undefined : await cache.match(key);
	if (hit) return hit.text();
	const value = await load();
	await cache.put(key, new Response(value, { headers: { "cache-control": `public, max-age=${TAG_TTL}` } }));
	return value;
}

/** Runs `work`; on failure serves the last good copy stored under `lastKey` (flagged stale), else rethrows. */
async function withLastGood<T>(cache: Cache, lastKey: Request, work: () => Promise<T>): Promise<Resolved<T>> {
	try {
		const value = await work();
		// Remember it as the fallback for outages.
		await cache.put(lastKey, new Response(JSON.stringify(value), { headers: { "cache-control": `public, max-age=${KEEP}` } }));
		return { value, stale: false };
	} catch (err) {
		const last = await cache.match(lastKey);
		if (last) return { value: (await last.json()) as T, stale: true };
		throw err;
	}
}

/** `fresh` (the `?fresh=1` cache-bust) skips the tag pointer so the redirect is asked again right now.
 * One call for the pages: resolves the latest tag, then loads + caches whatever hangs off it. */
export async function resolveLatest<T>(kind: string, load: (tag: string) => Promise<T>, fresh = false): Promise<Resolved<T>> {
	const cache = await caches.open(CACHE);
	return withLastGood(cache, new Request(`https://cache.invalid/${kind}/last`), async () => {
		const tag = await pointer(cache, "tag", latestTag, fresh);
		return cachedByTag(cache, `https://cache.invalid/${kind}/${tag}`, () => load(tag));
	});
}

/** The tags `releases.atom` lists (the 10 newest published, prereleases included). An unreachable or unreadable feed is an empty list:
 * beta and alpha then degrade to the stable tag instead of failing. */
async function feedTags(cache: Cache, fresh: boolean): Promise<string[]> {
	const xml = await pointer(
		cache,
		"feed",
		async () => {
			const res = await get(`https://github.com/${REPO}/releases.atom`);
			if (!res.ok) throw new Error(`releases.atom HTTP ${res.status}`);
			return res.text();
		},
		fresh,
	).catch(() => "");
	return atomTags(xml);
}

/** Newest candidate `channel` accepts whose `load` succeeds (the tag is pushed before the release is published: walk down). */
async function newestPublished<T>(channel: Channel, feed: string[], stable: string | null, kind: string, cache: Cache, load: (tag: string) => Promise<T>): Promise<T | null> {
	const candidates = [...feed];
	for (let tag = resolve(channel, candidates, stable); tag; tag = resolve(channel, candidates, stable)) {
		try {
			return await cachedByTag(cache, `https://cache.invalid/${kind}/${tag}`, () => load(tag));
		} catch (err) {
			// The stable tag is what `releases/latest` published: if even that cannot load, the outage handling above decides.
			if (tag === stable) throw err;
			candidates.splice(0, candidates.length, ...candidates.filter((c) => c !== tag));
		}
	}
	return null;
}

/** Like `resolveLatest`, for one channel. Stable is the existing redirect path; beta and alpha follow the newest published tag they
 * accept (never older than stable). The last good copy is kept per channel. `value` is null only when nothing is published at all. */
export async function resolveChannel<T>(kind: string, channel: Channel, load: (tag: string) => Promise<T>, fresh = false): Promise<Resolved<T | null>> {
	if (channel === "stable") return resolveLatest(kind, load, fresh);
	const cache = await caches.open(CACHE);
	return withLastGood(cache, new Request(`https://cache.invalid/${kind}/last/${channel}`), async () => {
		const stable = await pointer(cache, "tag", latestTag, fresh);
		return newestPublished(channel, await feedTags(cache, fresh), stable, kind, cache, load);
	});
}

/** Every channel at once, from one stable lookup and one feed fetch. Throws only when the stable lookup does and nothing is cached. */
export async function resolveChannels<T>(kind: string, load: (tag: string) => Promise<T>, fresh = false): Promise<Resolved<Record<Channel, T | null>>> {
	const cache = await caches.open(CACHE);
	return withLastGood(cache, new Request(`https://cache.invalid/${kind}/last/all`), async () => {
		const stable = await pointer(cache, "tag", latestTag, fresh);
		const feed = await feedTags(cache, fresh);
		const found = await Promise.all(CHANNELS.map((c) => newestPublished(c, feed, stable, kind, cache, load)));
		return Object.fromEntries(CHANNELS.map((c, i) => [c, found[i]])) as Record<Channel, T | null>;
	});
}

export async function loadRelease(tag: string): Promise<ReleaseInfo> {
	const res = await get(`https://github.com/${REPO}/releases/download/${tag}/manifest.json`);
	if (!res.ok) throw new Error(`manifest.json HTTP ${res.status}`);
	return toRelease(tag, (await res.json()) as Manifest);
}

export async function loadChangelog(tag: string): Promise<{ tag: string; markdown: string }> {
	const res = await get(`https://raw.githubusercontent.com/${REPO}/${tag}/CHANGELOG.md`);
	if (!res.ok) throw new Error(`CHANGELOG.md HTTP ${res.status}`);
	return { tag, markdown: await res.text() };
}

/** Shared response headers: a minute fresh at the edge and in browsers, a day of stale-while-revalidate, stale-if-error for outages. */
export const CACHE_CONTROL = `public, max-age=${TAG_TTL}, s-maxage=${TAG_TTL}, stale-while-revalidate=86400, stale-if-error=604800`;
