// Latest release, resolved at build time for /download. Asset names carry the version, so a stable
// `/releases/latest/download/<asset>` URL does not exist; the build reads the release's own manifest.json
// (version, date, sha256 and size per asset). If GitHub is unreachable the page still builds and falls back to
// the releases page (`resolved: false`), and the client script resolves the version again at runtime.
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
export async function latestRelease(): Promise<Release> {
	try {
		// /releases/latest redirects to the tag page: no API quota, no token.
		const head = await fetch(`https://github.com/${REPO}/releases/latest`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
		const tag = head.headers.get("location")?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
		if (!tag || !/^v?[0-9A-Za-z._-]+$/.test(tag)) return fallback;
		const res = await fetch(`https://github.com/${REPO}/releases/download/${tag}/manifest.json`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return fallback;
		const m = (await res.json()) as { version: string; date: string; assets: Record<string, Record<string, { url: string; sha256: string; size: number }>> };
		const a = m.assets?.[TARGET];
		if (!m.version || !a) return fallback;
		return {
			resolved: true,
			version: m.version,
			tag,
			date: m.date.slice(0, 10),
			notes: `${SITE.releases.replace("/latest", "")}/tag/${tag}`,
			dmg: a.desktop_dmg && { name: a.desktop_dmg.url.split("/").pop() ?? "", ...a.desktop_dmg },
			cli: a.cli && { name: a.cli.url.split("/").pop() ?? "", ...a.cli },
		};
	} catch {
		return fallback;
	}
}

export const fmtSize = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
export const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
