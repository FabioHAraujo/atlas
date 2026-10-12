// Latest release, resolved at build time for /download. Asset names carry the version, so a stable
// `/releases/latest/download/<asset>` URL does not exist; the build reads the release's own manifest.json
// (version, date, sha256 and size per asset). If GitHub is unreachable the page still builds and falls back to
// the releases page (`resolved: false`), and the client script resolves the version again at runtime.
import { CHANNELS, atomTags, resolve, type Channel } from "../../functions/_lib/channels";
import { SITE } from "./site";

const REPO = "codeatlasdev/atlas";
const TARGET = "aarch64-apple-darwin";

export interface Asset {
	name: string;
	url: string;
	sha256: string;
	size: number;
}
export interface Release {
	resolved: boolean;
	version: string;
	tag: string;
	/** ISO date (yyyy-mm-dd) */
	date: string;
	notes: string;
	dmg?: Asset;
	cli?: Asset;
}

const fallback: Release = { resolved: false, version: "", tag: "", date: "", notes: SITE.releases };

const timeout = () => AbortSignal.timeout(10_000);

async function stableTag(): Promise<string | null> {
	// /releases/latest redirects to the tag page: no API quota, no token.
	const head = await fetch(`https://github.com/${REPO}/releases/latest`, { method: "HEAD", redirect: "manual", signal: timeout() });
	const tag = head.headers.get("location")?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
	return tag && /^v?[0-9A-Za-z._-]+$/.test(tag) ? tag : null;
}

/** The release behind `tag` from its own manifest.json; null when it is not published (yet). */
async function releaseOf(tag: string): Promise<Release | null> {
	const res = await fetch(`https://github.com/${REPO}/releases/download/${tag}/manifest.json`, { signal: timeout() });
	if (!res.ok) return null;
	const m = (await res.json()) as { version: string; date: string; assets: Record<string, Record<string, { url: string; sha256: string; size: number }>> };
	const a = m.assets?.[TARGET];
	if (!m.version || !a) return null;
	return {
		resolved: true,
		version: m.version,
		tag,
		date: m.date.slice(0, 10),
		notes: `${SITE.releases.replace("/latest", "")}/tag/${tag}`,
		dmg: a.desktop_dmg && { name: a.desktop_dmg.url.split("/").pop() ?? "", ...a.desktop_dmg },
		cli: a.cli && { name: a.cli.url.split("/").pop() ?? "", ...a.cli },
	};
}

export async function latestRelease(): Promise<Release> {
	try {
		const tag = await stableTag();
		return (tag && (await releaseOf(tag))) || fallback;
	} catch {
		return fallback;
	}
}

/** What Beta and Alpha offer at build time (the same resolution the edge does: releases.atom + the stable tag, walking down past
 * tags whose release is not published yet). `null` for a channel with nothing newer than Stable: the page then says "No release yet"
 * and the edge (/channels.json) fills it in at runtime. */
export async function channelReleases(): Promise<Record<Exclude<Channel, "stable">, Release | null>> {
	const none = { beta: null, alpha: null };
	try {
		const stable = await stableTag();
		const res = await fetch(`https://github.com/${REPO}/releases.atom`, { signal: timeout() });
		if (!res.ok) return none;
		const feed = atomTags(await res.text());
		const out: Record<string, Release | null> = {};
		for (const c of CHANNELS.filter((c) => c !== "stable")) {
			let candidates = feed;
			out[c] = null;
			for (let tag = resolve(c, candidates, stable); tag && tag !== stable; tag = resolve(c, candidates, stable)) {
				out[c] = await releaseOf(tag);
				if (out[c]) break;
				candidates = candidates.filter((t) => t !== tag);
			}
		}
		return out as Record<Exclude<Channel, "stable">, Release | null>;
	} catch {
		return none;
	}
}

export const fmtSize = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
export const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
