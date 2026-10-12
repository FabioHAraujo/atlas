/**
 * Turns anything that was thrown into an `ErrorReport`, and an `ErrorReport` into the two things a
 * person does with it: copy the details, or file a GitHub issue. Pure functions; no DOM, no stores.
 *
 * Privacy: reports leave the machine only when the person clicks "Report issue", and even then
 * only the app version, the message and a stack trimmed to file names (no directories, no home
 * path, no env). Query strings and long hex/base64-looking tokens are dropped from messages.
 */

export interface ErrorReport {
	/** First line of the error, what the person reads. */
	message: string;
	/** Trimmed to the frames that matter; absolute paths are reduced to `file:line:col` by `fileNames`. */
	stack: string;
	/** What was rendering: `Editor`, `Terminal`, `window`, `route /tray`… */
	where: string;
	/** Tab kind when the error happened inside a pane. */
	kind?: string;
	/** File the pane was showing (editor tabs), already reduced to its file name. */
	file?: string;
	version?: string;
	/** What the person's machine and the last few things the app did looked like (never file contents). */
	context?: ErrorContext;
}

/** One thing the app did shortly before the error (a command, a host call, a navigation). */
export interface Breadcrumb {
	at: number;
	text: string;
}

export interface ErrorContext {
	os?: string;
	arch?: string;
	locale?: string;
	/** Route of the window (`/`, `/tray`). */
	route?: string;
	/** Terminal host (`atlas hostd`) version and capabilities, when it answered. */
	hostVersion?: string;
	hostCaps?: string[];
	/** Oldest first, newest last. */
	breadcrumbs: Breadcrumb[];
}

export const REPO_URL = "https://github.com/codeatlasdev/atlas";
const MAX_STACK_LINES = 12;
const MAX_TITLE = 100;
/** GitHub rejects URLs past ~8 KB; stay well below it. */
const MAX_BODY = 4000;

/** `AbortError` and WebKit's resize loop warning are normal operation, not bugs. */
const BENIGN = [
	/ResizeObserver loop/i,
	/^AbortError\b/,
	/The operation was aborted/i,
	/The user aborted a request/i,
];

export function isBenign(e: unknown, message = messageOf(e)): boolean {
	if (e instanceof DOMException && e.name === "AbortError") return true;
	if (e instanceof Error && e.name === "AbortError") return true;
	return BENIGN.some((r) => r.test(message));
}

export function messageOf(e: unknown): string {
	let m: string;
	if (typeof e === "string") m = e;
	else if (e instanceof Error) m = e.message || e.name;
	else if (e && typeof e === "object" && "message" in e) m = String(e.message);
	else {
		try {
			m = JSON.stringify(e) ?? String(e);
		} catch {
			m = String(e);
		}
	}
	return m.trim() || "Unknown error";
}

/** `/Users/x/proj/src/lib/Editor.svelte?t=123:45:6` → `Editor.svelte:45:6`; `(native)` stays. */
export function fileNames(stack: string): string {
	return stack
		.split("\n")
		.map((line) =>
			line.replace(
				/(?:[a-z][a-z0-9+.-]*:\/\/[^\s/)]*|\/)[^\s)]*?([^/\s)?:]+)(?:\?[^\s):]*)?(:\d+(?::\d+)?)/gi,
				"$1$2",
			),
		)
		.join("\n");
}

/** `Error.stack`, or the `stack` string SvelteKit's `handleError` result carries across the boundary. */
function stackOf(e: unknown): string {
	if (e instanceof Error) return e.stack ?? "";
	if (e && typeof e === "object" && "stack" in e && typeof e.stack === "string") return e.stack;
	return "";
}

/** Stack with the message line removed, file names only, capped. */
export function trimStack(e: unknown): string {
	const raw = stackOf(e);
	const lines = fileNames(raw)
		.split("\n")
		.map((l) => l.trimEnd())
		.filter(Boolean);
	// V8 prefixes the stack with "Name: message"; WebKit does not. Drop it when present.
	const frames = lines[0] && !/^\s*at\s|@/.test(lines[0]) ? lines.slice(1) : lines;
	return frames.slice(0, MAX_STACK_LINES).join("\n");
}

/** Strips a home directory and query strings; the message is shown and sent, so keep it tame. */
export function scrub(text: string): string {
	return text
		.replace(/\/Users\/[^/\s]+/g, "~")
		.replace(/\/home\/[^/\s]+/g, "~")
		.replace(/([?&](?:token|key|secret|password|auth)[^=&\s]*=)[^&\s]*/gi, "$1…");
}

export function report(e: unknown, ctx: Pick<ErrorReport, "where"> & Partial<ErrorReport>): ErrorReport {
	return {
		...ctx,
		message: scrub(messageOf(e)),
		stack: scrub(trimStack(e)),
	};
}

/** The text behind "Copy details". */
export function detailsText(r: ErrorReport): string {
	const head = [
		`Atlas ${r.version ?? "(version unknown)"}`,
		`Where: ${r.where}${r.kind ? ` (${r.kind})` : ""}`,
		r.file ? `File: ${r.file}` : "",
	].filter(Boolean);
	return [...head, "", r.message, r.stack ? `\n${r.stack}` : ""].join("\n").trimEnd();
}

const MAX_BREADCRUMBS = 20;
const MAX_CRUMB = 160;

/** Attach machine/app context; every free-text field is scrubbed and bounded. */
export function withContext(
	r: ErrorReport,
	c: Partial<ErrorContext> & { breadcrumbs?: Breadcrumb[] },
): ErrorReport {
	const crumbs = (c.breadcrumbs ?? [])
		.slice(-MAX_BREADCRUMBS)
		.map((b) => ({ at: b.at, text: scrub(b.text).slice(0, MAX_CRUMB) }));
	return { ...r, context: { ...c, breadcrumbs: crumbs } };
}

export interface CauseHint {
	title: string;
	/** One or two sentences: what it probably is and what to do about it. */
	detail: string;
}

/** The frame that most likely points at the culprit: first one inside the app (not a library). */
function topFrame(stack: string): string | undefined {
	return stack
		.split("\n")
		.map((l) => l.trim())
		.find((l) => /\.(svelte|ts|js)[:)]/.test(l) && !/node_modules/.test(l));
}

/**
 * A best-effort, honest guess at the cause, for the screen and the prompts. Only patterns that are
 * known to happen in this app; anything else returns `null` rather than a confident wrong answer.
 */
export function causeHint(r: ErrorReport): CauseHint | null {
	const frame = topFrame(r.stack);
	const at = frame ? ` Look at ${frame.replace(/^at\s+/, "")}.` : "";
	const host = r.context?.hostCaps;
	if (/\blsp_\w+|language server|unknown (command|cmd)/i.test(r.message) && host && !host.includes("lsp"))
		return {
			title: "The terminal host is older than this app",
			detail:
				"The background terminal host (atlas hostd) predates language-server support. Restart it from the status bar; terminals running in it will end.",
		};
	if (/undefined is not an object|cannot read propert|is undefined|is not a function/i.test(r.message))
		return {
			title: "The app received data in a shape it did not expect",
			detail: `A field the screen reads is missing, typically a name mismatch between the Rust backend (serde) and the frontend.${at}`,
		};
	if (/failed to fetch|networkerror|load failed|csp|content security/i.test(r.message))
		return {
			title: "A request was blocked or the backend did not answer",
			detail:
				"Check the Atlas desktop logs (`atlas desktop debug logs`) for a CSP violation or an IPC failure.",
		};
	return null;
}

const ctxLines = (r: ErrorReport): string[] => {
	const c = r.context;
	return [
		`- Atlas: ${r.version ?? "unknown"}`,
		`- Where: ${r.where}${r.kind ? ` (${r.kind})` : ""}`,
		r.file ? `- File: ${r.file}` : "",
		c?.os ? `- OS: ${c.os}${c.arch ? ` (${c.arch})` : ""}` : "",
		c?.locale ? `- Locale: ${c.locale}` : "",
		c?.route ? `- Route: ${c.route}` : "",
		c?.hostVersion
			? `- Terminal host: ${c.hostVersion}${c.hostCaps ? ` [${c.hostCaps.join(", ")}]` : ""}`
			: "",
	].filter(Boolean);
};

const crumbLines = (r: ErrorReport): string[] =>
	(r.context?.breadcrumbs ?? []).map((b) => `- ${new Date(b.at).toISOString().slice(11, 19)} ${b.text}`);

const fence = (t: string) => ["```", t, "```"];

/** A complete, paste-ready report: what an issue or an AI conversation starts from. */
export function markdownReport(r: ErrorReport, limit = MAX_BODY): string {
	const hint = causeHint(r);
	const crumbs = crumbLines(r);
	return [
		"# Atlas desktop error",
		"",
		"## Error",
		...fence(r.message.slice(0, 600)),
		"",
		"## Environment",
		...ctxLines(r),
		...(hint ? ["", "## Likely cause", `**${hint.title}.** ${hint.detail}`] : []),
		...(crumbs.length ? ["", "## Last things the app did", ...crumbs] : []),
		"",
		"## Stack (file names only)",
		...fence(r.stack || "(none)"),
	]
		.join("\n")
		.slice(0, limit);
}

/** Prefilled "new issue" URL. Opens in the system browser through `api.openUrl`. */
export function issueUrl(r: ErrorReport): string {
	const title = `[desktop] ${r.message.split("\n")[0]}`.slice(0, MAX_TITLE);
	const body = [
		"**What happened**",
		"<!-- Describe what you were doing when this appeared. -->",
		"",
		markdownReport(r, MAX_BODY - 200),
	]
		.join("\n")
		.slice(0, MAX_BODY);
	const q = new URLSearchParams({ title, body, labels: "bug" });
	return `${REPO_URL}/issues/new?${q}`;
}

const PROMPT_CAP = 9000;
const REPO = "codeatlasdev/atlas";

/** For a coding agent opened in an Atlas checkout: reproduce, test first, fix. */
export function aiFixPrompt(r: ErrorReport): string {
	return [
		`You are fixing a bug in Atlas desktop (${REPO}: Rust workspace in crates/*, SvelteKit frontend in apps/desktop). Read AGENTS.md first and follow its "Tests first" rule.`,
		"",
		"Process:",
		"1. Find the root cause from the report below (start at the first app frame of the stack).",
		"2. Write a failing test that reproduces it BEFORE touching the fix, and run it to watch it fail. If the bug is a Rust(serde)/TypeScript contract mismatch, the test must exercise the real serialized JSON, not a hand-written mock.",
		"3. Think through edge cases of the same root cause and add tests for them.",
		"4. Fix the root cause (not the symptom), show the tests pass, then run `bun run check`.",
		"",
		markdownReport(r, PROMPT_CAP - 1200),
	]
		.join("\n")
		.slice(0, PROMPT_CAP);
}

/** For an agent with `gh`: dedupe, then file a well-formed issue. */
export function aiIssuePrompt(r: ErrorReport): string {
	const title = `[desktop] ${r.message.split("\n")[0]}`.slice(0, MAX_TITLE).replace(/"/g, "'");
	return [
		`File a GitHub issue for this Atlas desktop error in ${REPO}. Do not change any code.`,
		"",
		`1. Search for an existing issue first: \`gh issue list --repo ${REPO} --state all --search "${title.replace(/^\[desktop\] /, "").slice(0, 60)}"\`. If one matches, comment on it with the environment below instead of opening a new one.`,
		`2. Otherwise create it: \`gh issue create --repo ${REPO} --label bug --title "${title}" --body-file -\` and use the report below as the body, adding a short "What I was doing" section from my description (ask me for it if you do not have it).`,
		"3. Reply with the issue URL.",
		"",
		markdownReport(r, PROMPT_CAP - 1200),
	]
		.join("\n")
		.slice(0, PROMPT_CAP);
}

/** For a person using any chat AI: explain it, say what to do now, no code changes. */
export function aiDiagnosePrompt(r: ErrorReport): string {
	return [
		"I use Atlas (a desktop app for running dev projects) and it showed this error screen. Explain what happened in plain language, what I can do right now to get back to work, and whether it is a bug I should report. Do not edit, change or run anything on my machine; only explain.",
		"",
		markdownReport(r, PROMPT_CAP - 600),
	]
		.join("\n")
		.slice(0, PROMPT_CAP);
}

/** Same error fired in a burst (a render loop, a timer) should surface once. */
export function fingerprint(r: Pick<ErrorReport, "message" | "stack">): string {
	return `${r.message}\n${r.stack.split("\n")[0] ?? ""}`;
}
