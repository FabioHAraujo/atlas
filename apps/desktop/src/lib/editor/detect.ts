/**
 * Text-shape detection and save-time normalisation: line endings, indentation, trailing
 * whitespace, final newline. Pure and linear: every scan is a single pass over charCodes
 * (no regex backtracking), and sampling is bounded so a 5 MB minified one-liner stays fast.
 */

export type Eol = "lf" | "crlf" | "cr";
export type IndentStyle = "space" | "tab";

const EOL_SAMPLE = 1_000_000;
const INDENT_LINES = 10_000;
const NEWLINE: Record<Eol, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };
const TAB = 9;
const SPACE = 32;
const LF = 10;
const CR = 13;
/** Indent widths worth reporting; a delta outside this list is noise (alignment, continuation lines). */
const MAX_INDENT = 8;

/** The line ending of `text` (first 1 MB): `lf` when there is none, `mixed` when more than one kind occurs. */
export function detectEol(text: string): Eol | "mixed" {
	const n = Math.min(text.length, EOL_SAMPLE);
	let lf = 0;
	let crlf = 0;
	let cr = 0;
	for (let i = 0; i < n; i++) {
		const c = text.charCodeAt(i);
		if (c === LF) lf++;
		else if (c === CR) {
			// A CR at the very end of the sample may be half of a CRLF cut by the window: look one past it.
			if (text.charCodeAt(i + 1) === LF) {
				crlf++;
				i++;
			} else cr++;
		}
	}
	const kinds = (lf > 0 ? 1 : 0) + (crlf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
	if (kinds > 1) return "mixed";
	if (crlf > 0) return "crlf";
	if (cr > 0) return "cr";
	return "lf";
}

/**
 * Indentation of `text` like VS Code's guesser: tabs when most indented lines start with a tab,
 * otherwise the most common positive indent delta between consecutive non-blank space-indented
 * lines (first ~10k lines). `fallback` when the text has no usable evidence.
 */
export function detectIndent(
	text: string,
	fallback: { style: IndentStyle; size: number },
): { style: IndentStyle; size: number } {
	let tabLines = 0;
	let spaceLines = 0;
	const histogram = new Map<number, number>();
	let prev = 0;
	let pos = 0;
	for (let line = 0; line < INDENT_LINES && pos < text.length; line++) {
		let end = text.indexOf("\n", pos);
		if (end === -1) end = text.length;
		// Leading whitespace only: stop at the first other char, so a huge line costs O(indent).
		let i = pos;
		let spaces = 0;
		let first = 0;
		for (; i < end; i++) {
			const c = text.charCodeAt(i);
			if (c === SPACE) spaces++;
			else if (c === TAB) spaces = spaces - (spaces % MAX_INDENT) + MAX_INDENT;
			else break;
			if (first === 0) first = c;
		}
		const blank = i >= end || (text.charCodeAt(i) === CR && i + 1 >= end);
		if (!blank) {
			if (first === TAB) tabLines++;
			else if (first === SPACE) {
				spaceLines++;
				const delta = Math.abs(spaces - prev);
				if (delta > 0 && delta <= MAX_INDENT) histogram.set(delta, (histogram.get(delta) ?? 0) + 1);
			}
			prev = first === SPACE ? spaces : 0;
		}
		pos = end + 1;
	}
	if (tabLines > spaceLines) return { style: "tab", size: fallback.style === "tab" ? fallback.size : 4 };
	let best = 0;
	let bestCount = 0;
	// Prefer the smaller width on ties: 2-space files also produce 4-deltas, never the reverse.
	for (const size of [...histogram.keys()].sort((a, b) => a - b)) {
		const count = histogram.get(size) ?? 0;
		if (count > bestCount) {
			best = size;
			bestCount = count;
		}
	}
	if (best === 0) return { ...fallback };
	return { style: "space", size: best };
}

/** `text` with every line ending (LF, CRLF, lone CR) replaced by `eol`. */
export function normalizeEol(text: string, eol: Eol): string {
	const nl = NEWLINE[eol];
	let out = "";
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c !== LF && c !== CR) continue;
		const len = c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
		// Already the wanted ending: leave the slice in place so clean files copy nothing per line.
		if (text.startsWith(nl, i) && nl.length === len) {
			i += len - 1;
			continue;
		}
		out += text.slice(from, i) + nl;
		i += len - 1;
		from = i + 1;
	}
	return from === 0 ? text : out + text.slice(from);
}

/** Whether the text ends with a line break (an empty text does not). */
export function hasFinalNewline(text: string): boolean {
	const last = text.charCodeAt(text.length - 1);
	return last === LF || last === CR;
}

/**
 * Remove spaces/tabs before each line break and at the end of the text. `skipLines` are 0-based
 * line indexes left untouched (the line being typed on, Markdown hard breaks…). Line-wise and
 * linear: one backwards scan per line, no regex.
 */
export function trimTrailingWhitespace(
	text: string,
	opts: { skipLines?: ReadonlySet<number> | number[] } = {},
): string {
	const skip = opts.skipLines instanceof Set ? opts.skipLines : new Set(opts.skipLines ?? []);
	const parts: string[] = [];
	let pos = 0;
	let line = 0;
	let changed = false;
	while (pos <= text.length) {
		let end = pos;
		while (end < text.length) {
			const c = text.charCodeAt(end);
			if (c === LF || c === CR) break;
			end++;
		}
		let keep = end;
		if (!skip.has(line)) {
			while (keep > pos) {
				const c = text.charCodeAt(keep - 1);
				if (c !== SPACE && c !== TAB) break;
				keep--;
			}
		}
		if (keep !== end) changed = true;
		parts.push(text.slice(pos, keep));
		if (end >= text.length) break;
		const crlf = text.charCodeAt(end) === CR && text.charCodeAt(end + 1) === LF;
		parts.push(crlf ? "\r\n" : text[end]);
		pos = end + (crlf ? 2 : 1);
		line++;
	}
	return changed ? parts.join("") : text;
}

/** The text as it is written to disk: trailing whitespace trimmed, final newline ensured, EOL normalised. */
export function applySavePolicy(
	text: string,
	policy: { trim: boolean; finalNewline: boolean; eol: Eol },
): string {
	let out = policy.trim ? trimTrailingWhitespace(text) : text;
	out = normalizeEol(out, policy.eol);
	if (policy.finalNewline && out.length > 0 && !hasFinalNewline(out)) out += NEWLINE[policy.eol];
	return out;
}
