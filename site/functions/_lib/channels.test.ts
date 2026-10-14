import { describe, expect, test } from "bun:test";
import { CHANNELS, DEFAULT_CHANNEL, type Channel, accepts, atomTags, channelOfVersion, channelsPayload, isChannel, parseTag, precedence, resolve, supersededPrerelease, withChannel } from "./channels";

// The vectors are shared with atlas-core (Rust): both resolvers must agree on every case.
const vectors = (await Bun.file(new URL("../../../testdata/channels/resolve.json", import.meta.url)).json()) as {
	cases: { name: string; tags: string[]; stable_tag: string | null; expect: Record<string, string | null> }[];
};
const atlasAtom = await Bun.file(new URL("../../../testdata/channels/releases.atom", import.meta.url)).text();
const zedAtom = await Bun.file(new URL("../../../testdata/channels/zed-releases.atom", import.meta.url)).text();

describe("resolve (shared vectors with atlas-core)", () => {
	test("the vector file is not empty", () => expect(vectors.cases.length).toBeGreaterThan(8));
	for (const c of vectors.cases)
		for (const ch of CHANNELS)
			test(`${c.name} [${ch}]`, () => expect(resolve(ch, c.tags, c.stable_tag)).toBe(c.expect[ch] ?? null));
});

describe("DEFAULT_CHANNEL", () => {
	// One decision, two languages: the Rust `#[default]` on `Channel` is the source of truth; the site must follow the same channel.
	test("is the variant marked #[default] on atlas_core::channel::Channel", async () => {
		const rs = await Bun.file(new URL("../../../crates/atlas-core/src/channel.rs", import.meta.url)).text();
		const rustDefault = rs.match(/#\[default\]\s*(\w+)/)?.[1]?.toLowerCase();
		expect(DEFAULT_CHANNEL).toBe(rustDefault as Channel);
	});
	test("is alpha until a real Stable exists, and is a known channel", () => {
		expect(DEFAULT_CHANNEL).toBe("alpha");
		expect(isChannel(DEFAULT_CHANNEL)).toBe(true);
	});
});

describe("parseTag", () => {
	test("accepts v-prefixed and bare versions, with prerelease and build", () => {
		expect(parseTag("v1.4.0-beta.2")).toMatchObject({ major: 1n, minor: 4n, patch: 0n, pre: ["beta", 2n] });
		expect(parseTag("1.4.0")).toMatchObject({ major: 1n, minor: 4n, patch: 0n, pre: [] });
		expect(parseTag("v1.4.0-beta.1+sha.abc")?.pre).toEqual(["beta", 1n]);
	});
	test("rejects leading zeros, empty identifiers, missing parts and junk", () => {
		for (const t of ["v1.4.0-alpha.01", "v01.2.3", "v1.02.3", "v1.2", "1.2.3.4", "nightly", "", "v", "v1.2.3-", "v1.2.3-a..b", "v1.2.3+", "v1.2.3-a_b", "@tauri-apps/cli-v2.12.2", " v1.2.3"])
			expect(parseTag(t)).toBeNull();
	});
	test("a numeric identifier of zero is fine, an alphanumeric one may start with zero", () => {
		expect(parseTag("v1.0.0-0")?.pre).toEqual([0n]);
		expect(parseTag("v1.0.0-0a")?.pre).toEqual(["0a"]);
		expect(parseTag("v1.0.0-alpha-1")?.pre).toEqual(["alpha-1"]);
	});
});

const cmp = (a: string, b: string) => precedence(parseTag(a)!, parseTag(b)!);

describe("precedence (SemVer 2.0 §11)", () => {
	test("alpha.10 > alpha.9 (numeric identifiers compare as numbers)", () => expect(cmp("1.0.0-alpha.10", "1.0.0-alpha.9")).toBeGreaterThan(0));
	test("alpha10 < alpha9 (alphanumeric identifiers compare lexically: the documented footgun)", () => expect(cmp("1.0.0-alpha10", "1.0.0-alpha9")).toBeLessThan(0));
	test("a release outranks its rc and betas", () => {
		expect(cmp("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
		expect(cmp("1.0.0-rc.1", "1.0.0-beta.9")).toBeGreaterThan(0);
	});
	test("the spec's own chain is strictly ascending", () => {
		const chain = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
		for (let i = 0; i < chain.length; i++)
			for (let j = 0; j < chain.length; j++) expect(Math.sign(cmp(chain[i], chain[j]))).toBe(Math.sign(i - j));
	});
	test("numeric identifiers rank below alphanumeric ones", () => expect(cmp("1.0.0-1", "1.0.0-a")).toBeLessThan(0));
	test("a longer identifier list outranks its prefix", () => expect(cmp("1.0.0-alpha.1.1", "1.0.0-alpha.1")).toBeGreaterThan(0));
	test("build metadata is ignored", () => {
		expect(cmp("1.0.0+a", "1.0.0+b")).toBe(0);
		expect(cmp("1.0.0-beta.1+x", "1.0.0-beta.1")).toBe(0);
	});
	test("numbers compare as numbers across major/minor/patch, beyond 2^53 too", () => {
		expect(cmp("1.10.0", "1.2.0")).toBeGreaterThan(0);
		expect(cmp("1.5.0-alpha.1", "1.4.0")).toBeGreaterThan(0);
		expect(cmp("1.0.0-alpha.9007199254740993", "1.0.0-alpha.9007199254740992")).toBeGreaterThan(0);
	});
});

describe("accepts / channelOfVersion", () => {
	const v = (t: string) => parseTag(t)!;
	test("which channel a build was cut for", () => {
		expect(channelOfVersion(v("1.4.0"))).toBe("stable");
		expect(channelOfVersion(v("1.4.0-alpha.1"))).toBe("alpha");
		expect(channelOfVersion(v("1.4.0-beta.1"))).toBe("beta");
		expect(channelOfVersion(v("1.4.0-rc.1"))).toBe("beta");
		expect(channelOfVersion(v("1.4.0-nightly.1"))).toBeNull();
		expect(channelOfVersion(v("1.4.0-alpha10"))).toBeNull();
	});
	test("stable takes releases only; beta adds beta/rc; alpha takes all three", () => {
		const table: [string, boolean, boolean, boolean][] = [
			["1.4.0", true, true, true],
			["1.4.0-rc.1", false, true, true],
			["1.4.0-beta.1", false, true, true],
			["1.4.0-alpha.1", false, false, true],
			["1.4.0-foo.1", false, false, false],
		];
		for (const [t, s, b, a] of table) expect([accepts("stable", v(t)), accepts("beta", v(t)), accepts("alpha", v(t))]).toEqual([s, b, a]);
	});
	test("isChannel narrows user input", () => {
		expect(["stable", "beta", "alpha"].every(isChannel)).toBe(true);
		for (const x of ["Stable", "nightly", "", null, undefined]) expect(isChannel(x)).toBe(false);
	});
});

describe("atomTags", () => {
	test("atlas feed: entry links in feed order, the feed-level link is not an entry", () => {
		expect(atomTags(atlasAtom)).toEqual(["v1.3.0", "v1.2.1", "v1.1.2", "v1.1.1", "v1.1.0"]);
	});
	test("zed feed keeps moving and unknown tags for the resolver to judge", () => {
		const tags = atomTags(zedAtom);
		expect(tags).toHaveLength(10);
		expect(tags).toContain("nightly");
		expect(tags).toContain("v1.24.2-pre");
		for (const c of CHANNELS) expect(resolve(c, tags, "v1.23.3")).toBe("v1.23.3");
	});
	test("percent-encoded tags are decoded", () => {
		const xml = `<feed><entry><link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/%40tauri-apps%2Fcli-v2.12.2"/></entry>
			<entry><link rel="alternate" href="https://github.com/o/r/releases/tag/v1.0.0-beta.1"/></entry></feed>`;
		expect(atomTags(xml)).toEqual(["@tauri-apps/cli-v2.12.2", "v1.0.0-beta.1"]);
	});
	test("garbage and empty feeds give no tags", () => {
		for (const xml of ["", "not xml", "<feed></feed>", "<entry>no link</entry>"]) expect(atomTags(xml)).toEqual([]);
	});
	test("a malformed percent escape is kept literally, not thrown", () => {
		expect(atomTags(`<entry><link rel="alternate" href="https://github.com/o/r/releases/tag/v1%zz"/></entry>`)).toEqual(["v1%zz"]);
	});
});

describe("supersededPrerelease (What's new / changelog Stable-only rule, same scenarios as atlas_core::github::in_range)", () => {
	const hidden = (versions: string[]) => versions.filter((v) => supersededPrerelease(v, versions));
	test("a stable release hides its own alphas, betas and rcs", () => {
		expect(hidden(["1.4.0", "1.4.0-rc.1", "1.4.0-beta.2", "1.4.0-alpha.3", "1.3.0"])).toEqual(["1.4.0-rc.1", "1.4.0-beta.2", "1.4.0-alpha.3"]);
	});
	test("a newer line's prerelease stays visible", () => {
		expect(hidden(["1.5.0-alpha.1", "1.4.0", "1.4.0-beta.1"])).toEqual(["1.4.0-beta.1"]);
	});
	test("a prerelease with no stable yet stays visible", () => {
		expect(hidden(["1.4.0-beta.1", "1.3.0"])).toEqual([]);
	});
	test("a stable release is never hidden, a hotfix does not hide the next line's prerelease", () => {
		expect(hidden(["1.3.1", "1.4.0-beta.1", "1.3.0"])).toEqual([]);
	});
	test("unparsable versions are never hidden", () => expect(hidden(["garbage", "1.0.0"])).toEqual([]));
});

describe("channelsPayload / withChannel (the real copy file, the real shapes)", () => {
	const rel = { tag: "v1.3.0", version: "1.3.0", date: "2026-10-12", notes: "n", resolvedAt: 1 };
	test("every channel of the shared copy file shows up once, in stable/beta/alpha order, with the release it resolved to", () => {
		const p = channelsPayload({ stable: rel, beta: null, alpha: null });
		expect(p.channels.map((c) => c.id)).toEqual(["stable", "beta", "alpha"]);
		expect(p.channels.map((c) => c.release)).toEqual([rel, null, null]);
		expect(p.stage).toBe("alpha");
		expect(p.stage_note).toContain("alpha");
		for (const c of p.channels) for (const k of ["label", "promise", "risk", "risk_label", "cadence", "audience", "switch_to"] as const) expect(c[k].length).toBeGreaterThan(2);
		expect(p.channels.map((c) => c.risk)).toEqual(["low", "medium", "high"]);
	});
	test("the copy has no private doc field leaking to the endpoint", () => expect(JSON.stringify(channelsPayload({ stable: null, beta: null, alpha: null }))).not.toContain("_doc"));
	test("withChannel marks the prerelease flag from the version", () => {
		expect(withChannel("stable", rel)).toEqual({ ...rel, channel: "stable", prerelease: false });
		expect(withChannel("alpha", { ...rel, version: "1.4.0-alpha.1" })).toMatchObject({ channel: "alpha", prerelease: true });
	});
});
