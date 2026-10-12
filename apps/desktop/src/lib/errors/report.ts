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

/** Prefilled "new issue" URL. Opens in the system browser through `api.openUrl`. */
export function issueUrl(r: ErrorReport): string {
	const title = `[desktop] ${r.message.split("\n")[0]}`.slice(0, MAX_TITLE);
	const body = [
		"**What happened**",
		"<!-- Describe what you were doing when this appeared. -->",
		"",
		"**Error**",
		"```",
		r.message.slice(0, 600),
		"```",
		"",
		"**Details**",
		`- Atlas: ${r.version ?? "unknown"}`,
		`- Where: ${r.where}${r.kind ? ` (${r.kind})` : ""}`,
		r.file ? `- File: ${r.file}` : null,
		"",
		"<details><summary>Stack</summary>",
		"",
		"```",
		r.stack || "(none)",
		"```",
		"",
		"</details>",
	]
		.filter((l) => l !== null)
		.join("\n")
		.slice(0, MAX_BODY);
	const q = new URLSearchParams({ title, body, labels: "bug" });
	return `${REPO_URL}/issues/new?${q}`;
}

/** Same error fired in a burst (a render loop, a timer) should surface once. */
export function fingerprint(r: Pick<ErrorReport, "message" | "stack">): string {
	return `${r.message}\n${r.stack.split("\n")[0] ?? ""}`;
}
