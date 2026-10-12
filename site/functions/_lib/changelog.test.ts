import { describe, expect, test } from "bun:test";
import { cmpVersionDesc, kindOf, parseChangelog, renderChangelog, renderMarkdown, versionId, visibleIn } from "./changelog";
import { changelogBody } from "./page";
import { toRelease } from "./release";

const MD = `# Changelog

Intro with [a link](https://semver.org).

> **Alpha.**

## [Unreleased]

### Added

- secret work in progress

## [1.2.0] — 2026-10-12

### Added

- **Bold** and \`code\`
- A <script>alert(1)</script> tag

### Fixed

- Thing

## [1.10.0] — 2026-11-01

### Added

- ten

## [1.2.0-rc.1] — 2026-10-01

- rc

## [1.1.2]

- no date
`;

describe("parseChangelog", () => {
	test("never exposes [Unreleased]", () => {
		const { entries } = parseChangelog(MD);
		expect(entries.map((e) => e.version)).not.toContain("Unreleased");
		expect(JSON.stringify(renderChangelog(MD))).not.toContain("secret work");
	});
	test("splits intro and versions, with dates and anchor ids", () => {
		const p = parseChangelog(MD);
		expect(p.intro).toContain("Intro with");
		expect(p.entries.map((e) => [e.version, e.date, e.id])).toEqual([
			["1.2.0", "2026-10-12", "v1-2-0"],
			["1.10.0", "2026-11-01", "v1-10-0"],
			["1.2.0-rc.1", "2026-10-01", "v1-2-0-rc-1"],
			["1.1.2", "", "v1-1-2"],
		]);
	});
	test("handles CRLF and an empty file", () => {
		expect(parseChangelog(MD.replace(/\n/g, "\r\n")).entries).toHaveLength(4);
		expect(parseChangelog("")).toEqual({ intro: "", entries: [] });
	});
});

describe("cmpVersionDesc", () => {
	test("orders numerically, newest first, release before its pre-release", () => {
		const v = ["1.2.0", "1.10.0", "1.2.0-rc.1", "1.1.2", "0.9.9"];
		expect(v.sort(cmpVersionDesc)).toEqual(["1.10.0", "1.2.0", "1.2.0-rc.1", "1.1.2", "0.9.9"]);
	});
	test("prereleases follow SemVer precedence, not string order (alpha.10 > alpha.9, rc > beta > alpha)", () => {
		const v = ["1.4.0-alpha.9", "1.4.0-beta.1", "1.4.0-alpha.10", "1.4.0", "1.4.0-rc.1", "1.5.0-alpha.1", "1.3.0"];
		expect(v.sort(cmpVersionDesc)).toEqual(["1.5.0-alpha.1", "1.4.0", "1.4.0-rc.1", "1.4.0-beta.1", "1.4.0-alpha.10", "1.4.0-alpha.9", "1.3.0"]);
	});
	test("a version that is not SemVer sorts last instead of throwing", () => expect(["garbage", "1.0.0"].sort(cmpVersionDesc)).toEqual(["1.0.0", "garbage"]));
	test("versionId is a stable anchor", () => expect(versionId("1.2.0")).toBe("v1-2-0"));
});

describe("kindOf", () => {
	test("labels the prerelease a version was cut as", () => {
		expect(["1.4.0", "1.4.0-alpha.2", "1.4.0-beta.1", "1.4.0-rc.1", "1.4.0-nightly.1", "garbage"].map(kindOf)).toEqual(["stable", "alpha", "beta", "rc", "pre", "stable"]);
	});
});

describe("visibleIn (changelog filter)", () => {
	const all = ["1.5.0-alpha.1", "1.4.0", "1.4.0-rc.1", "1.4.0-beta.2", "1.4.0-alpha.3", "1.3.0"];
	const view = (f: "all" | "stable" | "pre") => all.filter((v) => visibleIn(f, v, all));
	test("All keeps everything", () => expect(view("all")).toEqual(all));
	test("Stable only hides prereleases whose stable exists (1.4.0 hides its alpha/beta/rc); 1.5.0-alpha.1 stays", () => expect(view("stable")).toEqual(["1.5.0-alpha.1", "1.4.0", "1.3.0"]));
	test("Prereleases shows only prereleases, including superseded ones (they are history, not hidden)", () => expect(view("pre")).toEqual(["1.5.0-alpha.1", "1.4.0-rc.1", "1.4.0-beta.2", "1.4.0-alpha.3"]));
	test("Prereleases of a line with no stable yet all show", () => expect(["1.4.0-beta.1", "1.4.0-alpha.1", "1.3.0"].filter((v) => visibleIn("pre", v, ["1.4.0-beta.1", "1.4.0-alpha.1", "1.3.0"]))).toEqual(["1.4.0-beta.1", "1.4.0-alpha.1"]));
});

describe("renderMarkdown", () => {
	test("escapes raw HTML from the source", () => {
		const html = renderMarkdown("- A <script>alert(1)</script> tag");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});
	test("scopes heading ids to the version so anchors never collide", () => {
		const a = renderMarkdown("### Added\n\n### Added", "v1-2-0");
		expect(a).toContain('id="v1-2-0-added"');
		expect(a).toContain('id="v1-2-0-added-2"');
	});
	test("rejects javascript: links and marks external ones", () => {
		expect(renderMarkdown("[x](javascript:alert(1))")).toContain('href="#"');
		expect(renderMarkdown("[x](https://example.com)")).toContain('rel="noopener"');
	});
	test("renders GFM tables", () => expect(renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>"));
});

describe("changelogBody", () => {
	const c = renderChangelog(MD);
	test("lists every public version once, newest first", () => {
		const html = changelogBody(c, { tag: "v1.10.0", stale: false });
		expect(html.indexOf('href="#v1-10-0"')).toBeLessThan(html.indexOf('href="#v1-2-0"'));
		expect(html).not.toContain("Unreleased");
	});
	const pre = renderChangelog("# C\n\n## [1.4.0] — 2026-11-01\n\n- s\n\n## [1.4.0-beta.1] — 2026-10-20\n\n- b\n\n## [1.5.0-alpha.1] — 2026-11-05\n\n- a\n");
	test("prerelease sections carry a kind badge and data attributes for the filter; stable ones do not get a badge", () => {
		const html = changelogBody(pre, { tag: "v1.5.0-alpha.1", stale: false });
		expect(html).toContain('<section id="v1-5-0-alpha-1" data-version="1.5.0-alpha.1" data-kind="alpha"');
		expect(html).toContain('<span class="cl-badge cl-badge-alpha">Alpha</span>');
		expect(html).toContain('<span class="cl-badge cl-badge-beta">Beta</span>');
		expect(html).toContain('data-kind="stable"');
		expect(html.match(/cl-badge /g)).toHaveLength(4); // jump list + heading, for the two prereleases
	});
	test("the stable-only filter shows up only when there is a prerelease to filter, and defaults to All", () => {
		const html = changelogBody(pre, { tag: "v1.5.0-alpha.1", stale: false });
		expect(html).toContain('data-cl-filter');
		expect(html).toContain('value="all" checked');
		expect(html).toContain('data-cl-count role="status"'); // screen readers hear how many versions the filter leaves
		expect(changelogBody(c, { tag: "v1.10.0", stale: false })).toContain("data-cl-filter"); // MD has a 1.2.0-rc.1 entry
		expect(changelogBody(renderChangelog("# C\n\n## [1.0.0] — 2026-01-01\n\n- x\n"), { tag: "v1.0.0", stale: false })).not.toContain("data-cl-filter");
	});
	test("says so when serving the last good copy", () => {
		expect(changelogBody(c, { tag: "v1.2.0", stale: true })).toContain("last copy we fetched");
		expect(changelogBody(c, { tag: "v1.2.0", stale: false })).not.toContain("cl-stale");
	});
});

describe("toRelease", () => {
	const m = {
		version: "1.2.0",
		date: "2026-10-12T17:13:26.190884+00:00",
		assets: {
			"aarch64-apple-darwin": {
				cli: { url: "https://github.com/x/releases/download/v1.2.0/atlas-1.2.0-aarch64-apple-darwin.tar.gz", sha256: "aa", size: 1 },
				desktop_dmg: { url: "https://github.com/x/releases/download/v1.2.0/Atlas-1.2.0-aarch64-apple-darwin.dmg", sha256: "bb", size: 2 },
			},
		},
	};
	test("maps the manifest to the fields the page needs", () => {
		const r = toRelease("v1.2.0", m);
		expect([r.version, r.date, r.dmg?.name, r.dmg?.sha256, r.cli?.name]).toEqual(["1.2.0", "2026-10-12", "Atlas-1.2.0-aarch64-apple-darwin.dmg", "bb", "atlas-1.2.0-aarch64-apple-darwin.tar.gz"]);
		expect(r.notes).toBe("https://github.com/codeatlasdev/atlas/releases/tag/v1.2.0");
	});
	test("tolerates a release without a dmg", () => expect(toRelease("v1", { version: "1", date: "2026-01-01", assets: {} }).dmg).toBeUndefined());
});
