// Pure release-manifest mapping (no I/O), unit-tested.
export const REPO = "codeatlasdev/atlas";
const TARGET = "aarch64-apple-darwin";

export interface Asset {
	name: string;
	url: string;
	sha256: string;
	size: number;
}
export interface ReleaseInfo {
	tag: string;
	version: string;
	/** yyyy-mm-dd */
	date: string;
	notes: string;
	dmg?: Asset;
	cli?: Asset;
	/** epoch ms when this answer was resolved */
	resolvedAt: number;
}

export interface Manifest {
	version: string;
	date: string;
	assets?: Record<string, Record<string, { url: string; sha256: string; size: number }>>;
}

export function toRelease(tag: string, m: Manifest): ReleaseInfo {
	const a = m.assets?.[TARGET];
	return {
		tag,
		version: m.version,
		date: m.date.slice(0, 10),
		notes: `https://github.com/${REPO}/releases/tag/${tag}`,
		dmg: a?.desktop_dmg && { name: a.desktop_dmg.url.split("/").pop() ?? "", ...a.desktop_dmg },
		cli: a?.cli && { name: a.cli.url.split("/").pop() ?? "", ...a.cli },
		resolvedAt: Date.now(),
	};
}
