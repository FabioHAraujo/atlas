// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import {
	CHECK_EVERY_MS,
	EMPTY_PREFS,
	EMPTY_PROGRESS,
	badgesFor,
	blurbOf,
	compareVersions,
	dateOf,
	formatBytes,
	isSkipped,
	justUpdated,
	parseNotes,
	parsePrefs,
	percent,
	phaseFromLog,
	reduceProgress,
	selectNotes,
	shouldNotify,
	shouldRecheck,
	showPill,
	splitItem,
	stepsFrom,
	stripVersionHeading,
	versionAnchor,
} from "./updates.ts";

const rel = (version) => ({ version, url: "", published_at: "", notes: "" });
const prefs = (p = {}) => ({ ...EMPTY_PREFS, ...p });

describe("compareVersions", () => {
	test("numeric, not lexical; pre-release before release", () => {
		expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
		expect(compareVersions("v1.0.1", "1.0.0")).toBe(1);
	});
});

describe("selectNotes", () => {
	const all = [rel("1.0.0"), rel("1.0.2"), rel("0.9.0"), rel("1.0.1"), rel("1.0.2"), rel("1.0.3")];
	test("every version in (installed, latest], newest first, deduplicated", () => {
		expect(selectNotes(all, "1.0.0", "1.0.2").map((r) => r.version)).toEqual(["1.0.2", "1.0.1"]);
	});
	test("installed == latest yields just that release", () => {
		expect(selectNotes(all, "1.0.1", "1.0.1").map((r) => r.version)).toEqual(["1.0.1"]);
	});
	test("nothing newer yields nothing", () => {
		expect(selectNotes(all, "1.0.3", "1.0.3").map((r) => r.version)).toEqual(["1.0.3"]);
		expect(selectNotes([rel("1.0.0")], "1.0.0", "1.0.2")).toEqual([]);
	});
});

describe("skip", () => {
	test("skips exactly that version; a newer one comes back", () => {
		const p = prefs({ skipped: "1.0.2" });
		expect(isSkipped(p, "1.0.2")).toBe(true);
		expect(isSkipped(p, "1.0.3")).toBe(false);
		expect(isSkipped(p, null)).toBe(false);
	});
	test("pill hides when skipped, linked, or nothing is available", () => {
		expect(showPill(true, false, prefs(), "1.0.2")).toBe(true);
		expect(showPill(true, false, prefs({ skipped: "1.0.2" }), "1.0.2")).toBe(false);
		expect(showPill(true, true, prefs(), "1.0.2")).toBe(false);
		expect(showPill(false, false, prefs(), "1.0.2")).toBe(false);
	});
	test("persisted shape survives a round trip and garbage", () => {
		const p = prefs({ skipped: "1.0.2", notified: "1.0.2", lastSeen: "1.0.1", auto: false });
		expect(parsePrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
		expect(parsePrefs(undefined)).toEqual(EMPTY_PREFS);
		expect(parsePrefs({ skipped: 5, auto: "no" })).toEqual({ ...EMPTY_PREFS, auto: true });
	});
});

describe("shouldNotify", () => {
	const on = { notificationsOn: true, linked: false };
	test("once per version", () => {
		expect(shouldNotify(prefs(), "1.0.2", on)).toBe(true);
		expect(shouldNotify(prefs({ notified: "1.0.2" }), "1.0.2", on)).toBe(false);
		expect(shouldNotify(prefs({ notified: "1.0.2" }), "1.0.3", on)).toBe(true);
	});
	test("not when notifications are off, dev build, skipped or no version", () => {
		expect(shouldNotify(prefs(), "1.0.2", { ...on, notificationsOn: false })).toBe(false);
		expect(shouldNotify(prefs(), "1.0.2", { ...on, linked: true })).toBe(false);
		expect(shouldNotify(prefs({ skipped: "1.0.2" }), "1.0.2", on)).toBe(false);
		expect(shouldNotify(prefs(), null, on)).toBe(false);
	});
});

describe("justUpdated", () => {
	test("only when the running version is newer than the last seen one", () => {
		expect(justUpdated(prefs({ lastSeen: "1.0.1" }), "1.0.2")).toBe(true);
		expect(justUpdated(prefs({ lastSeen: "1.0.2" }), "1.0.2")).toBe(false);
		expect(justUpdated(prefs({ lastSeen: "1.0.3" }), "1.0.2")).toBe(false);
		expect(justUpdated(prefs(), "1.0.2")).toBe(false);
	});
});

describe("shouldRecheck", () => {
	test("on focus at most every 6h, and never with auto-check off", () => {
		const now = 10 * CHECK_EVERY_MS;
		expect(shouldRecheck(prefs(), null, now)).toBe(true);
		expect(shouldRecheck(prefs(), now - 1000, now)).toBe(false);
		expect(shouldRecheck(prefs(), now - CHECK_EVERY_MS, now)).toBe(true);
		expect(shouldRecheck(prefs({ auto: false }), null, now)).toBe(false);
	});
});

describe("progress reducer", () => {
	const run = (...events) => events.reduce(reduceProgress, EMPTY_PROGRESS);
	const phase = (id) => ({ kind: "phase", id });
	const states = (s) => s.map((x) => x.state);

	test("phases only move forward", () => {
		expect(run(phase("verify"), phase("download")).at).toBe(1);
		expect(run(phase("nope")).at).toBe(-1);
	});
	test("bytes belong to the current phase and reset on the next", () => {
		const mid = run(phase("download"), { kind: "bytes", done: 50, total: 200 });
		expect(percent(mid)).toBe(25);
		const next = reduceProgress(mid, phase("verify"));
		expect([next.done, next.total, percent(next)]).toEqual([0, 0, null]);
	});
	test("percent clamps and is null while the size is unknown", () => {
		expect(percent({ ...EMPTY_PROGRESS, done: 300, total: 200 })).toBe(100);
		expect(percent({ ...EMPTY_PROGRESS, done: 5, total: 0 })).toBeNull();
	});
	test("the host outcome is remembered", () => {
		const p = run({ kind: "host", state: "needs-restart", live: 2 });
		expect(p.host).toEqual({ state: "needs-restart", live: 2 });
	});
	test("rollback is remembered", () => {
		expect(run({ kind: "rollback", state: "restored" }).rollback).toBe("restored");
		expect(run({ kind: "rollback", state: "failed" }).rollback).toBe("failed");
	});
	test("steps: download is active before any report", () => {
		expect(states(stepsFrom(EMPTY_PROGRESS, "running"))).toEqual([
			"active",
			"pending",
			"pending",
			"pending",
			"pending",
			"pending",
		]);
	});
	test("steps follow the phase; failed marks the active one", () => {
		const p = run(phase("download"), phase("verify"), phase("install-cli"));
		expect(states(stepsFrom(p, "running"))).toEqual([
			"done",
			"done",
			"active",
			"pending",
			"pending",
			"pending",
		]);
		expect(states(stepsFrom(p, "failed"))).toEqual([
			"done",
			"done",
			"failed",
			"pending",
			"pending",
			"pending",
		]);
	});
	test("done completes the install; relaunch waits for the restart", () => {
		expect(states(stepsFrom(EMPTY_PROGRESS, "done"))).toEqual([
			"done",
			"done",
			"done",
			"done",
			"done",
			"pending",
		]);
		expect(states(stepsFrom(EMPTY_PROGRESS, "done", true))[5]).toBe("active");
	});
	test("an older CLI's lines still map to phases", () => {
		expect(phaseFromLog("◆ Downloading v1.0.2...")).toEqual(phase("download"));
		expect(phaseFromLog("◆ Installing...")).toEqual(phase("install-cli"));
		expect(phaseFromLog("◆ Updating Atlas Desktop to v1.0.2...")).toEqual(phase("update-app"));
		expect(phaseFromLog("◆ Downloading Atlas-1.0.2-aarch64.app.tar.gz...")).toEqual(phase("update-app"));
		expect(phaseFromLog("hello")).toBeNull();
	});
});

describe("dateOf", () => {
	// Whatever the machine's timezone, a calendar date is that same day (not the UTC day before).
	test("a date-only string is its own local calendar day", () => {
		const expected = new Date(2026, 9, 12).toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
		expect(dateOf("2026-10-12", "en-US")).toBe(expected);
		expect(dateOf("2026-10-12", "en-US")).toBe("Oct 12, 2026");
	});
	test("impossible or empty dates give nothing", () => {
		expect(dateOf("2026-02-31", "en-US")).toBe("");
		expect(dateOf("", "en-US")).toBe("");
		expect(dateOf("soon", "en-US")).toBe("");
	});
	test("a full timestamp still parses", () => {
		expect(dateOf("2026-10-12T15:00:00Z", "en-US")).toMatch(/Oct 1[23], 2026/);
	});
});

test("formatBytes", () => {
	expect(formatBytes(0)).toBe("");
	expect(formatBytes(512)).toBe("1 KB");
	expect(formatBytes(860 * 1024)).toBe("860 KB");
	expect(formatBytes(12.4 * 1024 * 1024)).toBe("12.4 MB");
});

describe("parseNotes", () => {
	const md = [
		"## [1.2.1] — 2026-10-12",
		"",
		"Faster startup and a new theme system.",
		"",
		"Atlas is in **alpha**: expect bugs. Please [report](https://x.y).",
		"",
		"### Added",
		"",
		"- **Language servers, built in.** Completion for `Rust` and Go.",
		"- **Plain: colon.** Body.",
		"- No title here, just text.",
		"",
		"### Fixed",
		"",
		"- Window drag failed.",
		"  It works again.",
		"- **Faster startup.** First screen loads less:",
		"  - editor",
		"  - charts",
		"",
		"### Weird",
		"",
		"- x",
		"",
		"### Empty",
	].join("\n");
	const n = parseNotes(md);

	test("summary is the first paragraph; the alpha boilerplate is split out", () => {
		expect(n.summary).toBe("Faster startup and a new theme system.");
		expect(n.alpha).toContain("alpha");
	});
	test("groups keep order, map kinds and drop empty ones", () => {
		expect(n.groups.map((g) => [g.kind, g.heading, g.items.length])).toEqual([
			["added", "Added", 3],
			["fixed", "Fixed", 2],
			["other", "Weird", 1],
		]);
	});
	test("`**Title.** body` splits into title and body", () => {
		expect(n.groups[0].items[0]).toEqual({
			title: "Language servers, built in",
			body: "Completion for `Rust` and Go.",
		});
		expect(n.groups[0].items[1].title).toBe("Plain: colon");
	});
	test("a bullet without the convention keeps the whole text as body", () => {
		expect(n.groups[0].items[2]).toEqual({ title: "", body: "No title here, just text." });
	});
	test("continuation lines and nested bullets stay in the body", () => {
		expect(n.groups[1].items[0].body).toBe("Window drag failed.\nIt works again.");
		expect(n.groups[1].items[1].body).toBe("First screen loads less:\n\n- editor\n\n- charts");
	});
	test("notes without summary or groups", () => {
		expect(parseNotes("")).toEqual({ summary: "", alpha: "", groups: [] });
		expect(parseNotes("- **A.** b").groups).toEqual([]);
	});
	test("a bold lead with nothing after it is not a title", () => {
		expect(splitItem("**Only bold**")).toEqual({ title: "", body: "**Only bold**" });
		expect(splitItem("**T** — body")).toEqual({ title: "T", body: "body" });
	});
});

test("badgesFor", () => {
	expect(badgesFor("1.2.1", "1.1.0", "1.2.1", false)).toEqual(["latest"]);
	expect(badgesFor("1.1.0", "1.1.0", "1.2.1", false)).toEqual(["installed"]);
	expect(badgesFor("1.2.1", "1.2.1", "1.2.1", false)).toEqual(["latest", "installed"]);
	expect(badgesFor("1.2.1", "1.2.1", "1.2.1", true)).toEqual(["latest", "new"]);
	expect(badgesFor("1.2.0", "1.1.0", "1.2.1", false)).toEqual([]);
});

test("versionAnchor is a safe DOM id", () => {
	expect(versionAnchor("1.2.1")).toBe("v-1-2-1");
	expect(versionAnchor("1.2.1-rc.1")).toBe("v-1-2-1-rc-1");
});

test("stripVersionHeading drops the leading release heading only", () => {
	expect(stripVersionHeading("## [1.0.1] — 2026-10-11\n\n### Changed\n\n- x")).toBe("### Changed\n\n- x");
	expect(stripVersionHeading("### Changed\n- x")).toBe("### Changed\n- x");
});

test("blurbOf prefers the summary, then the first change, and caps its length", () => {
	expect(blurbOf(parseNotes("Faster startup.\n\n### Added\n- **A.** b"))).toBe("Faster startup.");
	expect(blurbOf(parseNotes("### Fixed\n- **No more flash.** The window opens hidden."))).toBe(
		"No more flash",
	);
	expect(blurbOf(parseNotes("### Fixed\n- Plain `code` text."))).toBe("Plain code text.");
	expect(blurbOf(parseNotes("### Fixed\n- " + "x".repeat(200))).length).toBe(90);
	expect(blurbOf(parseNotes(""))).toBe("");
});
