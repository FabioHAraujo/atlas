// The release engine: the site never has a copy of "the latest release", it asks GitHub at the edge.
//
//   latest tag      github.com/<repo>/releases/latest redirect (no API quota, no token)
//   changelog       raw.githubusercontent.com/<repo>/<tag>/CHANGELOG.md   (pinned to the tag: never a half-written main)
//   assets          github.com/<repo>/releases/download/<tag>/manifest.json (version, date, sha256, size per asset)
//
// Freshness: the tag lookup is cached for TAG_TTL seconds (a new release shows within ~1 minute); everything that
// hangs off a tag is immutable and cached per tag. If GitHub is down or slow we serve the last good copy (the Cache
// API entry is kept for a day past its TTL) instead of failing, so the page is never empty and never old by choice.

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

/** `fresh` (the `?fresh=1` cache-bust) skips the tag pointer so the redirect is asked again right now.
 * One call for the pages: resolves the latest tag, then loads + caches whatever hangs off it. */
export async function resolveLatest<T>(kind: string, load: (tag: string) => Promise<T>, fresh = false): Promise<Resolved<T>> {
	const cache = await caches.open(CACHE);
	const lastKey = new Request(`https://cache.invalid/${kind}/last`);
	try {
		// Tag pointer: short TTL, this is what makes a new release visible within a minute.
		let tag: string | undefined;
		const ptr = new Request(`https://cache.invalid/tag`);
		const hit = fresh ? undefined : await cache.match(ptr);
		if (hit) tag = await hit.text();
		else {
			tag = await latestTag();
			await cache.put(ptr, new Response(tag, { headers: { "cache-control": `public, max-age=${TAG_TTL}` } }));
		}
		const value = await cachedByTag(cache, `https://cache.invalid/${kind}/${tag}`, () => load(tag));
		// Remember it as the fallback for outages.
		await cache.put(lastKey, new Response(JSON.stringify(value), { headers: { "cache-control": `public, max-age=${KEEP}` } }));
		return { value, stale: false };
	} catch (err) {
		const last = await cache.match(lastKey);
		if (last) return { value: (await last.json()) as T, stale: true };
		throw err;
	}
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
