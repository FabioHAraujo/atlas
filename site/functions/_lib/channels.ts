// Release-channel resolution (pure, no I/O, unit-tested in channels.test.ts). A TypeScript port of `atlas_core::channel`
// and `atlas_core::github::atom_tags`; both sides are pinned by testdata/channels/resolve.json so they cannot drift.
//
//   stable  releases only
//   beta    releases, rc, beta
//   alpha   releases, rc, beta, alpha
//
// A channel follows the highest SemVer precedence among the tags it accepts. Labels Atlas does not ship (`nightly`,
// `foo`) are accepted by no channel, and anything that is not valid SemVer is ignored.

import copy from "../../../crates/atlas-core/data/channels.json";
import type { ReleaseInfo } from "./release";

export const CHANNELS = ["stable", "beta", "alpha"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The channel a visitor gets when they did not choose one: the site's Download button, `/release.json` and `/changelog*`.
 * Mirrors `#[default]` on `atlas_core::channel::Channel` (channels.test.ts reads that file and fails if they differ). Pre-GA it
 * is Alpha; flipping it back to Stable is this line plus the Rust attribute. */
export const DEFAULT_CHANNEL: Channel = "alpha";

/** Type guard for user input (`?channel=`): exact lowercase names only. */
export const isChannel = (x: unknown): x is Channel => CHANNELS.includes(x as Channel);

export interface Version {
	major: bigint;
	minor: bigint;
	patch: bigint;
	/** Prerelease identifiers: numeric ones as bigint, the rest as strings. Empty for a release. */
	pre: (bigint | string)[];
}

// SemVer 2.0 grammar: no leading zeros on numeric parts, non-empty dot-separated [0-9A-Za-z-] identifiers, build metadata ignored.
const NUM = "(0|[1-9][0-9]*)";
const IDENT = "[0-9A-Za-z-]+";
const SEMVER = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-(${IDENT}(?:\\.${IDENT})*))?(?:\\+${IDENT}(?:\\.${IDENT})*)?$`);

/** Parses `v1.4.0-beta.2+build` or `1.4.0`. Returns null for anything that is not valid SemVer (including leading zeros). */
export function parseTag(tag: string): Version | null {
	const m = SEMVER.exec(tag.startsWith("v") ? tag.slice(1) : tag);
	if (!m) return null;
	const pre = m[4] === undefined ? [] : m[4].split(".");
	// A numeric identifier with a leading zero is invalid; an alphanumeric one (`0a`) is fine.
	if (pre.some((id) => /^0[0-9]+$/.test(id))) return null;
	return { major: BigInt(m[1]), minor: BigInt(m[2]), patch: BigInt(m[3]), pre: pre.map((id) => (/^[0-9]+$/.test(id) ? BigInt(id) : id)) };
}

const cmp = <T extends number | bigint | string>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

/** SemVer 2.0 §11 precedence (build metadata is not part of a Version). Negative when a < b. */
export function precedence(a: Version, b: Version): number {
	const core = cmp(a.major, b.major) || cmp(a.minor, b.minor) || cmp(a.patch, b.patch);
	if (core) return core;
	// A version without prerelease outranks the same version with one.
	if (!a.pre.length || !b.pre.length) return cmp(b.pre.length, a.pre.length);
	for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
		const x = a.pre[i];
		const y = b.pre[i];
		if (typeof x === typeof y) {
			const d = cmp(x, y);
			if (d) return d;
		} else return typeof x === "bigint" ? -1 : 1; // numeric identifiers rank below alphanumeric ones
	}
	return cmp(a.pre.length, b.pre.length);
}

/** The channel a build of `v` was cut for; null for a label Atlas does not ship. */
export function channelOfVersion(v: Version): Channel | null {
	if (!v.pre.length) return "stable";
	switch (v.pre[0]) {
		case "alpha":
			return "alpha";
		case "beta":
		case "rc":
			return "beta";
		default:
			return null;
	}
}

/** Whether `channel` offers `v`: stable takes releases only, beta adds beta/rc, alpha adds alpha. */
export function accepts(channel: Channel, v: Version): boolean {
	const of = channelOfVersion(v);
	if (of === null) return false;
	return CHANNELS.indexOf(channel) >= CHANNELS.indexOf(of);
}

/** The tag `channel` should follow: highest precedence among the accepted tags. `tags` is what `releases.atom` lists (any
 * order, junk allowed); `stableTag` is the newest Stable (see `stableTag()` above: never the raw `releases/latest`
 * redirect, which is an alpha pre-GA) and is always a candidate, so a channel is never worse than Stable even when the 10-entry
 * feed window no longer reaches it. */
export function resolve(channel: Channel, tags: Iterable<string>, stableTag: string | null): string | null {
	let best: { tag: string; v: Version } | null = null;
	for (const tag of [...tags, ...(stableTag ? [stableTag] : [])]) {
		const v = parseTag(tag);
		if (v && accepts(channel, v) && (!best || precedence(v, best.v) > 0)) best = { tag, v };
	}
	return best?.tag ?? null;
}

/** Feed pages read at most while looking for a Stable behind a run of prereleases (10 releases each). */
export const STABLE_PAGES = 5;

/** The newest Stable (no prerelease label) among the feed `tags` and the `releases/latest` redirect. Pre-GA the redirect is the newest
 * alpha (release.yml publishes the default channel's builds as ordinary releases), so it is only a candidate, never trusted.
 * `readMore(oldestSeen)` returns the feed page after `oldestSeen` (`releases.atom?after=`); it is asked only while no Stable shows
 * up and the last page was full (10), at most `STABLE_PAGES` pages in all. Same rule as `atlas_core::github::stable_tag`. */
export async function stableTag(first: string[], latest: string | null, readMore: (after: string) => Promise<string[]>): Promise<string | null> {
	const seen = [...first];
	let page = first.length;
	for (let i = 0; i < STABLE_PAGES; i++) {
		const found = resolve("stable", seen, latest);
		if (found || page < 10) return found;
		const older = await readMore(seen[seen.length - 1]).catch(() => []);
		page = older.length;
		if (!older.length) return null;
		seen.push(...older);
	}
	return resolve("stable", seen, latest);
}

/** Whether `version` is a prerelease whose own release (same major.minor.patch) is also in `versions`: the stable section is
 * the complete summary, so the Stable-only changelog view hides its alphas, betas and rcs. Same rule as `atlas_core::github::in_range`. */
export function supersededPrerelease(version: string, versions: Iterable<string>): boolean {
	const v = parseTag(version);
	if (!v?.pre.length) return false;
	for (const other of versions) {
		const o = parseTag(other);
		if (o && !o.pre.length && o.major === v.major && o.minor === v.minor && o.patch === v.patch) return true;
	}
	return false;
}

/** Entry tags of a `releases.atom` feed in feed order (newest published first), percent-decoded. Moving tags (`nightly`) and
 * non-release tags are kept: judging them is `resolve`'s job. Same behavior as `atlas_core::github::atom_tags`. */
export function atomTags(xml: string): string[] {
	const mark = "/releases/tag/";
	const tags: string[] = [];
	for (const entry of xml.split("<entry>").slice(1)) {
		const link = entry.split("</entry>")[0].split("<link ").find((l) => l.includes('rel="alternate"'));
		const href = link?.split('href="')[1]?.split('"')[0];
		const at = href?.indexOf(mark) ?? -1;
		const raw = at < 0 ? "" : href!.slice(at + mark.length);
		if (raw) tags.push(percentDecode(raw));
	}
	return tags;
}

/** Decodes valid %XX escapes as UTF-8 and leaves malformed ones literal (decodeURIComponent would throw). */
function percentDecode(s: string): string {
	const bytes: number[] = [];
	const enc = new TextEncoder();
	for (let i = 0; i < s.length; ) {
		const hex = s.slice(i + 1, i + 3);
		if (s[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
			bytes.push(parseInt(hex, 16));
			i += 3;
		} else {
			const cp = s.codePointAt(i) ?? 0;
			bytes.push(...enc.encode(String.fromCodePoint(cp)));
			i += cp > 0xffff ? 2 : 1;
		}
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A release as `/release.json?channel=` answers it. */
export type ChannelRelease = ReleaseInfo & { channel: Channel; prerelease: boolean };

export function withChannel(channel: Channel, release: ReleaseInfo): ChannelRelease {
	return { ...release, channel, prerelease: (parseTag(release.version)?.pre.length ?? 0) > 0 };
}

/** The `/channels.json` body: the copy from crates/atlas-core/data/channels.json (the one source the CLI and Desktop also use)
 * plus what each channel offers right now (`null` when nothing is published for it). */
export function channelsPayload(releases: Record<Channel, ReleaseInfo | null>) {
	return {
		stage: copy.stage,
		stage_note: copy.stage_note,
		channels: copy.channels.map(({ id, label, promise, risk, risk_label, cadence, audience, switch_to }) => ({
			id: id as Channel,
			label,
			promise,
			risk,
			risk_label,
			cadence,
			audience,
			switch_to,
			release: releases[id as Channel] ?? null,
		})),
	};
}
