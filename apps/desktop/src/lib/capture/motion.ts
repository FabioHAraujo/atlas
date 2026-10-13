/** Pure helpers for scripted recordings: easing, the pointer's path, key-combo parsing. No DOM, no clock. */

import type { Rect } from "./timeline.ts";

export interface Point {
	x: number;
	y: number;
}

export function easeInOutCubic(t: number): number {
	if (!(t > 0)) return 0;
	if (t >= 1) return 1;
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Largest sideways bow of the pointer's path, as a fraction of the distance travelled. */
const MAX_BOW = 0.12;

/**
 * Points (steps + 1 of them) from `a` to `b` along an eased quadratic arc: a pointer that travels in a slight curve
 * and decelerates into its target reads as a hand, a straight constant-speed line reads as a bot. Deterministic:
 * the bow depends only on the endpoints, so a re-run of a recipe draws the same path.
 */
export function cursorPath(a: Point, b: Point, steps: number): Point[] {
	const n = Math.max(1, Math.floor(steps));
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dist = Math.hypot(dx, dy);
	if (dist === 0) return Array.from({ length: n + 1 }, () => ({ x: a.x, y: a.y }));
	// control point: the midpoint pushed sideways (always to the same side of travel, scaled by distance)
	const bow = dist * MAX_BOW * 2; // a quadratic curve reaches half of its control offset
	const cx = (a.x + b.x) / 2 + (-dy / dist) * bow;
	const cy = (a.y + b.y) / 2 + (dx / dist) * bow;
	const out: Point[] = [];
	for (let i = 0; i <= n; i++) {
		if (i === 0) {
			out.push({ x: a.x, y: a.y });
			continue;
		}
		if (i === n) {
			out.push({ x: b.x, y: b.y });
			continue;
		}
		const t = easeInOutCubic(i / n);
		const u = 1 - t;
		out.push({
			x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
			y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
		});
	}
	return out;
}

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export interface Combo {
	key: string;
	code: string;
	meta: boolean;
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
}

const NAMED: Record<string, string> = {
	escape: "Escape",
	enter: "Enter",
	left: "ArrowLeft",
	right: "ArrowRight",
	up: "ArrowUp",
	down: "ArrowDown",
	tab: "Tab",
	space: " ",
	backspace: "Backspace",
};
const MODS = ["cmd", "shift", "ctrl", "alt"];

/** "cmd-shift-p", "ctrl-cmd-s", "alt-cmd-right", "escape", "cmd--" -> the fields of a DOM KeyboardEvent. */
export function parseCombo(s: string): Combo {
	if (!s) throw new Error("empty key combo");
	const parts = s.split("-");
	let k = parts.pop() ?? "";
	if (s.endsWith("--")) {
		k = "-";
		parts.pop(); // the empty segment before the minus key
	}
	for (const m of parts)
		if (!MODS.includes(m)) throw new Error(`unknown modifier "${m}" in "${s}" (use ${MODS.join(", ")})`);
	const key = NAMED[k] ?? k;
	const code = /^[a-z]$/.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : key;
	return {
		key,
		code,
		meta: parts.includes("cmd"),
		shift: parts.includes("shift"),
		ctrl: parts.includes("ctrl"),
		alt: parts.includes("alt"),
	};
}
