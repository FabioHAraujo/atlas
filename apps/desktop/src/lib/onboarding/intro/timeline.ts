/**
 * The welcome intro as pure data: `frame(t)` is everything the renderer draws at time `t` seconds. The renderer, the
 * storyboard screenshots, the sound cue and the tests all read this one function, so picture and sound cannot drift.
 *
 * The shot (see local welcome-motion-brief): black stage, a hairline of light, 36 tiles of the real Atlas mark streak
 * in on arcs and lock together on one HIT (sound downbeat), the camera pushes into the mark, the copy resolves last.
 */
import { MARK, MARK_VIEW } from "./mark.ts";

/** A tile that moves: the sheets of the mark and its rim pieces. Sub-pixel specks of the hand trace stay still. */
export interface Tile {
	id: number;
	kind: "sheet" | "rim";
	cx: number;
	cy: number;
	w: number;
	h: number;
	/** Where the tile starts (unit-box offset from home, in logo units) and the arc it bows along. */
	from: { x: number; y: number };
	bow: number;
	/** Seconds after BEATS.beams that it starts, and how long its flight takes. */
	delay: number;
	fly: number;
}

const SHEET_MIN = 8000;
const RIM_MIN = 100;

/** Deterministic 0..1 from an integer (so the sky is the same every run). */
const hash01 = (n: number) => {
	let x = Math.imul(n + 1, 0x9e3779b1) >>> 0;
	x ^= x >>> 15;
	x = Math.imul(x, 0x85ebca6b) >>> 0;
	return (x >>> 0) / 4294967296;
};

export const BEATS = {
	line: 0.12,
	/** Beams start while the hairline is still extending (overlap, not a hard cut). */
	beams: 0.45,
	anticipate: 1.55,
	hit: 1.68,
	/** The sound cue: the earcon's downbeat transient is authored to land here. */
	soundAt: 1.68,
	sweep: 1.9,
	push: 2.65,
	copy: 3.25,
} as const;
export const DURATION = 3.9;

/** Seconds between consecutive tiles inside a group, and the length of one flight. */
const PER = 0.02;
const FLY = 0.36;
/** Fast flight is the first FAST_FRACTION of a flight; the rest is the slow settle that reads as landed. */
export const FAST_FRACTION = 0.5;
/** Seconds between the groups (rows of the mark): a hero reveal staggers groups 100-200 ms apart. */
const GROUP_GAP = 0.2;

const animated = MARK.filter((m) => m.w * m.h >= RIM_MIN);
const isSheet = (m: { w: number; h: number }) => m.w * m.h >= SHEET_MIN;
/** The mark's rows: tiles arrive top, middle, bottom, each row as a unit (a rim piece rides with the row it edges). */
const rowOf = (cy: number) => (cy < MARK_VIEW.h * 0.333 ? 0 : cy < MARK_VIEW.h * 0.667 ? 1 : 2);

export const TILES: Tile[] = (() => {
	const rank = new Map<number, number>();
	const seen = [0, 0, 0];
	// Order inside a row: left to right, so the row reads as a wipe.
	for (const m of [...animated].sort((a, b) => a.cx - b.cx)) rank.set(m.id, seen[rowOf(m.cy)]!++);
	return animated.map((m) => {
		// Direction away from the mark's centre; tiles enter from outside the frame along that ray, bowed sideways.
		const dx = m.cx - MARK_VIEW.w / 2;
		const dy = m.cy - MARK_VIEW.h / 2;
		const len = Math.hypot(dx, dy) || 1;
		const reach = 620 + hash01(m.id) * 260;
		const side = hash01(m.id + 99) < 0.5 ? -1 : 1;
		return {
			id: m.id,
			kind: isSheet(m) ? ("sheet" as const) : ("rim" as const),
			cx: m.cx,
			cy: m.cy,
			w: m.w,
			h: m.h,
			from: { x: (dx / len) * reach, y: (dy / len) * reach },
			bow: side * (60 + hash01(m.id + 7) * 90),
			delay: rowOf(m.cy) * GROUP_GAP + rank.get(m.id)! * PER,
			fly: FLY,
		};
	});
})();

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeInOut = (x: number) => {
	const t = clamp01(x);
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
export const easeOutExpo = (x: number) => {
	const t = clamp01(x);
	return t === 1 ? 1 : 1 - 2 ** (-10 * t);
};
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;

/** Per-tile stagger numbers for the tests and the budget. */
export function stagger() {
	const starts = TILES.map((t) => t.delay);
	return { per: PER, total: Math.max(...starts) - Math.min(...starts) };
}

export interface TileState {
	id: number;
	/** Offset from the tile's home in logo units (0,0 = locked in). */
	dx: number;
	dy: number;
	alpha: number;
	/** 0..1: how lit the tile is (the sweep and the hit). */
	glow: number;
}

export interface Frame {
	t: number;
	/** The opening hairline: 0 (none) .. 1 (full width). */
	line: number;
	tiles: TileState[];
	/** White flash of the hit (0..1) and the ring it radiates (0..1 = expanding). */
	flash: number;
	ring: number;
	/** Scale of the mark (1 = rest, overshoots just after the hit). */
	markScale: number;
	/** Camera push: 1 = rest, grows as we move into the mark; `markFade` dims the mark as we pass through it. */
	push: number;
	markFade: number;
	/** The gradient sweep over the mark (0..1, -1 = not started). */
	sweep: number;
	/** Opacity of the headline and the actions. */
	copy: number;
	/** Draw the 'Atlas' wordmark (it resolves from the intro's hit, so only intro frames have it). */
	wordmark: boolean;
}

/** How far before the hit tiles hang off their slots (anticipation), logo units. */
const PULL = 9;

function tileAt(tile: Tile, t: number): TileState {
	const start = BEATS.beams + tile.delay;
	if (t < start) return { id: tile.id, dx: tile.from.x, dy: tile.from.y, alpha: 0, glow: 0 };
	// Flight to the pull-back position, then the pull-back to home on the hit.
	const k = easeOutExpo((t - start) / tile.fly);
	const arc = Math.sin(Math.PI * k) * tile.bow;
	const len = Math.hypot(tile.from.x, tile.from.y) || 1;
	// Perpendicular to the flight direction for the bow.
	const px = -tile.from.y / len;
	const py = tile.from.x / len;
	let x = tile.from.x * (1 - k) + px * arc * (1 - k);
	let y = tile.from.y * (1 - k) + py * arc * (1 - k);
	const alpha = clamp01((t - start) / 0.12);
	let glow = 0.35 * k;
	// Anticipation: after landing, hang PULL off the slot, brightness dips, then snap home on the hit.
	if (t >= BEATS.anticipate) {
		const a = clamp01((t - BEATS.anticipate) / (BEATS.hit - BEATS.anticipate));
		const away = PULL * easeInOut(a);
		const ux = tile.cx - MARK_VIEW.w / 2;
		const uy = tile.cy - MARK_VIEW.h / 2;
		const ul = Math.hypot(ux, uy) || 1;
		x = (ux / ul) * away;
		y = (uy / ul) * away;
		glow = 0.35 - 0.15 * a;
	}
	if (t >= BEATS.hit) {
		// Locked at the hit, with a short overshoot of the pull (follow-through) folded into the mark scale.
		x = 0;
		y = 0;
		glow = 0.35 + 0.65 * easeOutCubic(1 - clamp01((t - BEATS.hit) / 0.5));
	}
	return { id: tile.id, dx: x, dy: y, alpha, glow };
}

/** The settled welcome: the mark at rest behind the copy. What reduced motion and "skip" show. */
export function settled(): Frame {
	return frame(DURATION);
}

export function frame(time: number): Frame {
	const t = Number.isFinite(time) ? Math.min(Math.max(time, 0), DURATION) : 0;
	const end = t >= DURATION;
	const hit = t - BEATS.hit;
	const sweepK = (t - BEATS.sweep) / 0.7;
	const pushK = easeInOut((t - BEATS.push) / (DURATION - BEATS.push));
	// Overshoot then settle: a damped bump right after the hit.
	const bump = hit < 0 ? 0 : 0.045 * Math.exp(-hit * 9) * Math.sin(hit * 28 + 0.4);
	return {
		t,
		line:
			end || t < BEATS.line
				? 0
				: easeInOut((t - BEATS.line) / 0.6) *
					(t < BEATS.beams + 0.3 ? 1 : 1 - easeInOut((t - BEATS.beams - 0.3) / 0.3)),
		tiles: end
			? TILES.map((x) => ({ id: x.id, dx: 0, dy: 0, alpha: 1, glow: 0 }))
			: TILES.map((x) => tileAt(x, t)),
		flash: hit < 0 ? 0 : end ? 0 : Math.max(0, 1 - hit / 0.5) ** 2,
		ring: hit < 0 ? 0 : clamp01(hit / 0.9),
		markScale: 1 + Math.max(0, bump) + (hit < 0 ? 0 : 0.02 * (1 - clamp01(hit / 1.2))),
		push: 1 + 0.5 * pushK,
		markFade: 1 - 0.78 * pushK,
		sweep: sweepK < 0 ? -1 : clamp01(sweepK),
		copy: t < BEATS.push ? 0 : easeOutCubic((t - BEATS.push) / (DURATION - BEATS.push)),
		wordmark: !end,
	};
}

/** Tiles in fast flight (the first 60% of the flight; the rest is the slow settle read as landed) at `t`: the 1/3 rule is asserted on this. */
export function inFlight(t: number): number {
	return TILES.filter((x) => t >= BEATS.beams + x.delay && t < BEATS.beams + x.delay + x.fly * FAST_FRACTION)
		.length;
}

export const WORD = "Atlas";

export interface Letter {
	/** 0..1 opacity. */
	alpha: number;
	/** Extra letter-spacing as a fraction of the font size; tightens to 0. */
	spread: number;
	/** Rise from below, as a fraction of the font size; eases to 0. */
	dy: number;
}

/** Seconds after the hit that the first letter starts, between letters, and how long one letter takes to resolve. */
const WORD_DELAY = 0.18;
const WORD_PER = 0.07;
const WORD_LIFE = 0.5;

/** "Atlas" resolving from the light: letters arrive left to right, tracking tightens, and it clears for the push. */
export function wordmark(time: number): Letter[] {
	const t = Number.isFinite(time) ? Math.min(Math.max(time, 0), DURATION) : 0;
	// Leaves with the push: fully gone by the end.
	const leave = easeInOut((t - BEATS.push) / (DURATION - BEATS.push));
	return [...WORD].map((_, i) => {
		const k = easeOutExpo((t - (BEATS.hit + WORD_DELAY + i * WORD_PER)) / WORD_LIFE);
		return { alpha: k * (1 - leave), spread: 0.22 * (1 - k), dy: 0.28 * (1 - k) };
	});
}
