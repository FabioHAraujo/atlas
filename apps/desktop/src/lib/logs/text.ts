/** Small text helpers for rendering and exporting log lines. */

import { contrast, fromOklch, isDark } from "#lib/theme/color.ts";
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

/**
 * The colour of a service's name/dot for `hue` (0-359): the design colour (`oklch(0.68 0.14 hue)`), lifted in
 * lightness only until it reads 4.5:1 on EVERY surface in `surfaces` (a light theme needs it darker, a dark one lighter).
 */
export function serviceColor(hue: number, surfaces: string[]): string {
	const base = fromOklch({ l: 0.68, c: 0.14, h: hue });
	const bg = surfaces.map((s) => s.slice(0, 7));
	const reads = (c: string) => bg.every((b) => contrast(c, b) >= 4.5);
	if (reads(base)) return base;
	const dark = bg.every((b) => isDark(b));
	for (let i = 1; i <= 70; i++) {
		const c = fromOklch({ l: 0.68 + (dark ? i : -i) * 0.005, c: 0.14, h: hue });
		if (reads(c)) return c;
	}
	return dark ? "#ffffff" : "#000000";
}

/** Estimated wrapped height in rows of a line, given the columns available. */
export function wrappedRows(len: number, cols: number): number {
	return len <= cols || cols < 8 ? 1 : Math.ceil(len / cols);
}
