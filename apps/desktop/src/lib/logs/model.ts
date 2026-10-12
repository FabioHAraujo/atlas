/**
 * Log line model: the wire/buffer types, level detection, wire → line conversion and the
 * fixed-capacity `Ring` every other module in `lib/logs/` reads from. No Svelte, no DOM.
 */

import { stripAnsi } from "#lib/ansi.ts";

export type Level = "error" | "warn" | "info";

export interface LogLine {
	seq: number;
	name: string;
	/** Plain text (escapes removed): search, level, copy. */
	line: string;
	/** Original text when it carried escapes: parsed lazily for visible rows only. */
	raw?: string;
	stream: string;
	ts: number;
	level: Level;
	/** Marker rows (service restart, stack start) instead of output. */
	mark?: string;
	/** Which separator a marker row is: a service `restart` or a user/system `mark`. */
	kind?: "restart" | "mark";
}

/** One log entry as the runner / desktop batch sends it (`seq`/`level`/`kind`/`trunc` need a current runner). */
export interface RawLog {
	name: string;
	line: string;
	stream: string;
	ts: number;
	level?: "debug" | "info" | "warn" | "error";
	kind?: "restart" | "mark";
	trunc?: boolean;
}

export const RANK: Record<Level, number> = { info: 0, warn: 1, error: 2 };

/**
 * Same rule as the Rust `LogLevel::detect` (`atlas-tui/src/runtime/logs.rs`), minus `debug`, which the
 * desktop shows as info: whole-word `error|err|fatal|panic` (error) or `warn|warning` (warn) tokens, not
 * preceded by `/ . - _` (paths, URLs, identifiers). `"0 errors found"` is info. Both sides are tested against
 * `testdata/log-levels.json`.
 */
const LEVEL_RE = /(?<![\p{L}\p{N}_])(error|err|fatal|panic|warn|warning)(?![\p{L}\p{N}_])/giu;
export function levelOf(line: string): Level {
	let level: Level = "info";
	for (const m of line.matchAll(LEVEL_RE)) {
		if (m.index > 0 && "/.-_".includes(line[m.index - 1]!)) continue;
		const found: Level = /^warn/i.test(m[1]!) ? "warn" : "error";
		if (RANK[found] > RANK[level]) level = found;
	}
	return level;
}

// ───────────────────────── ring buffer ─────────────────────────

/**
 * Fixed-capacity line store. Appends push to a plain array and trim in slabs
 * (`slack`) so a full buffer does not shift `cap` entries per line. `base` is the
 * global index of `items[0]`, which stays stable across trims so views can keep
 * absolute positions.
 */
export class Ring<T> {
	items: T[] = [];
	/** Number of items ever dropped from the front. */
	base = 0;
	constructor(
		readonly cap: number,
		readonly slack = Math.max(1, cap >> 3),
	) {}

	get length() {
		return this.items.length;
	}

	/** Append; returns how many items were trimmed from the front (0 most of the time). */
	push(batch: T[]): number {
		for (const x of batch) this.items.push(x);
		if (this.items.length <= this.cap + this.slack) return 0;
		const drop = this.items.length - this.cap;
		this.items = this.items.slice(drop);
		this.base += drop;
		return drop;
	}

	clear() {
		this.base += this.items.length;
		this.items = [];
	}
}

/**
 * Wire entry → buffered line. Escapes are stripped for search/level and the original is kept
 * only when it differs (parsed lazily for visible rows). The runner's level wins, `debug` ranks
 * as info, and an older runner without `level` falls back to `levelOf`, which follows the same word-token rule as the TUI.
 * `restart`/`mark` rows become separators whose text is the line without its `────` rules.
 */
export function toLogLine(r: RawLog, seq: number): LogLine {
	const raw = r.line;
	const line = raw.includes("\x1b") || raw.includes("\r") ? stripAnsi(raw) : raw;
	const level = r.level ? (r.level === "debug" ? "info" : r.level) : levelOf(line);
	const l: LogLine = { seq, name: r.name, line, stream: r.stream, ts: r.ts, level };
	if (line !== raw) l.raw = raw;
	if (r.kind) {
		l.mark = line.replace(/^[─\s]+|[─\s]+$/g, "");
		l.kind = r.kind;
	}
	return l;
}
