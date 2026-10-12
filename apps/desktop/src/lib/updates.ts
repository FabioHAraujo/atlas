/**
 * Everything about updates that can be decided without the DOM or Tauri: which releases the
 * "What's new" sheet shows, skip/notify-once rules, the post-update toast, the install steps
 * derived from the CLI's output, and the persisted state. `stores/updates.svelte.ts` wires it up.
 */

export interface ReleaseNotes {
	version: string;
	url: string;
	published_at: string;
	notes: string;
}

/** Persisted under `updates` in settings.json. */
export interface UpdatePrefs {
	/** Version the user chose to skip: no pill, no notification until a newer one ships. */
	skipped: string | null;
	/** Last version a native notification was sent for (once per version). */
	notified: string | null;
	/** Version the app ran last time: a different one means it was just updated. */
	lastSeen: string | null;
	/** Check on launch and every 6 hours. */
	auto: boolean;
}

export const EMPTY_PREFS: UpdatePrefs = { skipped: null, notified: null, lastSeen: null, auto: true };

export const CHECK_EVERY_MS = 6 * 3600 * 1000;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Parse whatever settings.json holds into valid prefs. */
export function parsePrefs(raw: unknown): UpdatePrefs {
	if (!raw || typeof raw !== "object") return { ...EMPTY_PREFS };
	const r = raw as Record<string, unknown>;
	return {
		skipped: str(r.skipped),
		notified: str(r.notified),
		lastSeen: str(r.lastSeen),
		auto: r.auto !== false,
	};
}

/** Numeric semver compare (`1.10.0 > 1.9.9`; a pre-release sorts before its release). */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => {
		const [core, pre] = v.replace(/^v/, "").split("+")[0].split(/-(.*)/s);
		return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
	};
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
		const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
		if (d) return d < 0 ? -1 : 1;
	}
	if (x.pre === y.pre) return 0;
	if (x.pre === null) return 1;
	if (y.pre === null) return -1;
	return x.pre < y.pre ? -1 : 1;
}

/**
 * Releases the sheet shows, newest first: every one in `(installed, latest]`. When the app
 * already runs `latest` (after an update) it is just that release. Duplicates collapse.
 */
export function selectNotes(releases: ReleaseNotes[], installed: string, latest: string): ReleaseNotes[] {
	const seen = new Set<string>();
	const inRange = releases.filter((r) => {
		if (seen.has(r.version)) return false;
		seen.add(r.version);
		return installed === latest
			? r.version === latest
			: compareVersions(r.version, installed) > 0 && compareVersions(r.version, latest) <= 0;
	});
	return inRange.sort((a, b) => compareVersions(b.version, a.version));
}

/** The user skipped exactly this version (a newer one is not covered by the skip). */
export const isSkipped = (prefs: UpdatePrefs, version: string | null | undefined): boolean =>
	!!version && prefs.skipped === version;

/** Show the sidebar pill / banner: a release is available, not skipped, and no dev link. */
export const showPill = (
	available: boolean,
	linked: boolean,
	prefs: UpdatePrefs,
	version: string | null | undefined,
): boolean => available && !linked && !isSkipped(prefs, version);

/** Send a native notification: new version, not skipped, not already notified, notifications on. */
export function shouldNotify(
	prefs: UpdatePrefs,
	version: string | null | undefined,
	opts: { notificationsOn: boolean; linked: boolean },
): boolean {
	return (
		!!version &&
		opts.notificationsOn &&
		!opts.linked &&
		!isSkipped(prefs, version) &&
		prefs.notified !== version
	);
}

/**
 * Show "Updated to X" once: the app runs a version different from the one it ran last time,
 * and it is newer (a downgrade or a first launch with nothing stored is silent).
 */
export function justUpdated(prefs: UpdatePrefs, running: string): boolean {
	return !!prefs.lastSeen && compareVersions(running, prefs.lastSeen) > 0;
}

/** Re-check on window focus when auto-check is on and the last check is at least `CHECK_EVERY_MS` old. */
export function shouldRecheck(prefs: UpdatePrefs, checkedAt: number | null, now: number): boolean {
	return prefs.auto && (checkedAt === null || now - checkedAt >= CHECK_EVERY_MS);
}

export type StepId = "download" | "verify" | "install-cli" | "update-app" | "terminal-host" | "relaunch";
type StepState = "pending" | "active" | "done" | "failed";
export interface Step {
	id: StepId;
	label: string;
	state: StepState;
}

const STEPS: { id: StepId; label: string }[] = [
	{ id: "download", label: "Download" },
	{ id: "verify", label: "Verify" },
	{ id: "install-cli", label: "Install CLI" },
	{ id: "update-app", label: "Update app" },
	{ id: "terminal-host", label: "Terminal host" },
	{ id: "relaunch", label: "Relaunch" },
];
const ORDER = STEPS.map((s) => s.id);

/** `updates://progress` payloads (parsed from the CLI's `@@atlas` lines in Rust). */
export type ProgressEvent =
	| { kind: "phase"; id: string }
	| { kind: "bytes"; done: number; total: number }
	| { kind: "rollback"; state: string }
	| { kind: "host"; state: string; live: number };

/** What the install has reported so far. */
export interface Progress {
	/** Index into the steps of the phase under way (-1 before the first report). */
	at: number;
	/** Bytes of the download in the current phase (total 0 = unknown). */
	done: number;
	total: number;
	/** The CLI had to be put back because the app could not be updated. */
	rollback: "restored" | "failed" | null;
	/** How `atlas update` left the terminal host (`needs-restart` = running terminals, user decides). */
	host: { state: string; live: number } | null;
}

export const EMPTY_PROGRESS: Progress = { at: -1, done: 0, total: 0, rollback: null, host: null };

/** Fold one event into the progress; phases only move forward, bytes belong to the current phase. */
export function reduceProgress(p: Progress, e: ProgressEvent): Progress {
	switch (e.kind) {
		case "phase": {
			const i = ORDER.indexOf(e.id as StepId);
			// A new phase starts a new download counter (the app's tarball after the CLI's).
			return i > p.at ? { ...p, at: i, done: 0, total: 0 } : p;
		}
		case "bytes":
			return { ...p, done: e.done, total: e.total };
		case "rollback":
			return { ...p, rollback: e.state === "restored" ? "restored" : "failed" };
		case "host":
			return { ...p, host: { state: e.state, live: e.live } };
	}
}

/**
 * Phases from the lines an older CLI prints (it has no `@@atlas` protocol and announces its
 * work with `◆ Downloading…`, `◆ Installing…`, `Updating Atlas Desktop…`).
 */
export function phaseFromLog(line: string): ProgressEvent | null {
	if (/Downloading Atlas-|Updating Atlas Desktop/i.test(line)) return { kind: "phase", id: "update-app" };
	if (/Installing\b/i.test(line)) return { kind: "phase", id: "install-cli" };
	if (/Downloading\b/i.test(line)) return { kind: "phase", id: "download" };
	return null;
}

/**
 * The step list for the sheet and Settings. `failed` marks the active step; `done` completes
 * every step except Relaunch, which is only done once the app restarts (`relaunched`).
 */
export function stepsFrom(
	p: Progress,
	outcome: "running" | "done" | "failed",
	relaunchNeeded = false,
): Step[] {
	return STEPS.map((s, i) => {
		let state: StepState;
		if (s.id === "relaunch") state = outcome === "done" && relaunchNeeded ? "active" : "pending";
		else if (outcome === "done") state = "done";
		else if (i < p.at) state = "done";
		else if (i === p.at) state = outcome === "failed" ? "failed" : "active";
		else state = "pending";
		// Before anything is reported, "Download" is what is happening.
		if (p.at === -1 && i === 0 && outcome !== "done") state = outcome === "failed" ? "failed" : "active";
		return { ...s, state };
	});
}

/** `42%` of a known download; null while the size is unknown. */
export function percent(p: Progress): number | null {
	return p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
}

/** `12.4 MB` / `860 KB`; empty for an unknown size. */
export function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
	return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * A release date for display. CHANGELOG dates are calendar dates (`2026-10-12`): they are
 * formatted as that local calendar day, never through `new Date("2026-10-12")`, which is UTC
 * midnight and shows the previous day west of Greenwich. Full timestamps are parsed normally.
 * Unparseable input gives "".
 */
export function dateOf(iso: string, locale?: string): string {
	const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
	const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(iso);
	if (m) {
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const date = new Date(y, mo - 1, d);
		// `new Date(2026, 1, 31)` rolls over to March: reject impossible dates.
		if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return "";
		return date.toLocaleDateString(locale, opts);
	}
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale, opts);
}

/** Drop a leading `## [x] — date` heading from a release body so the sheet's own header is not doubled. */
export function stripVersionHeading(notes: string): string {
	return notes.replace(/^\s*#{1,3}\s*\[?v?\d+\.\d+\.\d+[^\n]*\n+/, "").trim();
}

export type GroupKind = "added" | "changed" | "fixed" | "security" | "removed" | "deprecated" | "other";

export interface ChangeItem {
	/** The `**Title.**` lead of the bullet ("" when the bullet has none). */
	title: string;
	/** The rest of the bullet, markdown. */
	body: string;
}

export interface ChangeGroup {
	kind: GroupKind;
	/** The `###` heading as written. */
	heading: string;
	items: ChangeItem[];
}

export interface ParsedNotes {
	/** First paragraph before the first `###` (alpha boilerplate removed), "" when none. */
	summary: string;
	/** The "Atlas is in alpha" paragraph, shown as a footer note. */
	alpha: string;
	groups: ChangeGroup[];
}

const KINDS: Record<string, GroupKind> = {
	added: "added",
	new: "added",
	changed: "changed",
	improved: "changed",
	fixed: "fixed",
	security: "security",
	removed: "removed",
	deprecated: "deprecated",
};

/** Keep a Changelog heading → kind; unknown headings are `other`. */
export const kindOf = (heading: string): GroupKind => KINDS[heading.trim().toLowerCase()] ?? "other";

const ALPHA = /\balpha\b/i;

/** `**Title.** body` / `**Title:** body` / `**Title** — body` → title + body; otherwise no title. */
export function splitItem(text: string): ChangeItem {
	const m = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(text.trim());
	if (!m) return { title: "", body: text.trim() };
	const title = m[1].replace(/[.:]\s*$/, "").trim();
	const body = m[2].replace(/^[—–-]\s+/, "").trim();
	// A bold phrase that is really the start of the sentence ("**Never** do X") has no body to split off.
	return body ? { title, body } : { title: "", body: text.trim() };
}

/**
 * A release's markdown (our CHANGELOG convention) as `{ summary, alpha, groups }`:
 * paragraphs before the first `###` are the summary (the alpha boilerplate is split out),
 * each `###` heading is a group, each top-level bullet an item (continuation lines and nested
 * bullets stay in the item's body).
 */
export function parseNotes(markdown: string): ParsedNotes {
	const lines = stripVersionHeading(markdown).split("\n");
	const intro: string[] = [];
	const groups: ChangeGroup[] = [];
	let group: ChangeGroup | null = null;
	let item: string[] | null = null;
	const flush = () => {
		if (group && item) group.items.push(splitItem(item.join("\n")));
		item = null;
	};
	for (const line of lines) {
		const h = /^#{3}\s+(.+?)\s*$/.exec(line);
		if (h) {
			flush();
			group = { kind: kindOf(h[1]), heading: h[1], items: [] };
			groups.push(group);
		} else if (!group) {
			intro.push(line);
		} else if (/^[-*]\s+/.test(line)) {
			flush();
			item = [line.replace(/^[-*]\s+/, "")];
		} else if (item && line.trim()) {
			// Continuation (indented or lazy); an indented bullet stays a nested list line.
			item.push(/^\s+[-*]\s+/.test(line) ? `\n- ${line.replace(/^\s+[-*]\s+/, "")}` : line.trim());
		} else if (!item && line.trim()) {
			// Prose under a heading without bullets becomes an item of its own.
			item = [line.trim()];
		}
	}
	flush();
	const paras = intro
		.join("\n")
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s*\n\s*/g, " ").trim())
		.filter(Boolean);
	return {
		summary: paras.filter((p) => !ALPHA.test(p)).join(" "),
		alpha: paras.find((p) => ALPHA.test(p)) ?? "",
		groups: groups.filter((g) => g.items.length > 0),
	};
}

/** Bodies longer than this fold behind "More" in the sheet. */
export const FOLD_AT = 190;

/** Whether an item's body is long enough to fold. */
export const isLong = (i: ChangeItem): boolean => i.body.length > FOLD_AT;

/**
 * The install is `behind` (an update is on offer), `new` (just installed it), or `current`
 * (it is what runs); drives the badges of a release's hero.
 */
export type ReleaseTag = "latest" | "installed" | "new";

/** Badges for `version` given the running version, the latest one and whether it was just installed. */
export function badgesFor(
	version: string,
	running: string | undefined,
	latest: string | undefined,
	justInstalled: boolean,
): ReleaseTag[] {
	const tags: ReleaseTag[] = [];
	if (latest && version === latest) tags.push("latest");
	if (justInstalled && running === version) tags.push("new");
	else if (running === version) tags.push("installed");
	return tags;
}

/** DOM id of a version's block (`1.2.1` → `v-1-2-1`), for the sticky index. */
export const versionAnchor = (version: string): string => `v-${version.replace(/[^0-9a-z]+/gi, "-")}`;

/**
 * One line about a release for the "Updated to X" card: the changelog's own summary, else the
 * title (or first words) of the first change. "" when the release lists nothing.
 */
export function blurbOf(n: ParsedNotes): string {
	if (n.summary) return n.summary;
	const first = n.groups[0]?.items[0];
	if (!first) return "";
	const text = first.title || first.body.replace(/[`*_]/g, "");
	return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
}
