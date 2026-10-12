/** Small text helpers for rendering and exporting log lines. */

import type { LogLine } from "./model.ts";

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `HH:MM:SS` (local time), or with `.mmm` for the clipboard. */
export function hms(ts: number, ms = false): string {
	const d = new Date(ts);
	const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	return ms ? `${t}.${pad(d.getMilliseconds(), 3)}` : t;
}

/** Plain-text export of lines, as `HH:MM:SS [service] text`. */
export function format(lines: LogLine[], withTime = true): string {
	return lines
		.map((l) =>
			l.mark !== undefined ? `── ${l.mark} ──` : `${withTime ? `${hms(l.ts)} ` : ""}[${l.name}] ${l.line}`,
		)
		.join("\n");
}

/** Hue (0–359) for a service name: stable chip/label color. */
export function hue(name: string): number {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
	return h;
}

/** Estimated wrapped height in rows of a line, given the columns available. */
export function wrappedRows(len: number, cols: number): number {
	return len <= cols || cols < 8 ? 1 : Math.ceil(len / cols);
}
