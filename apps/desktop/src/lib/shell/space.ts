/** Spaces: one per repo. Deterministic accent per id, ordering and switching, pure for tests. */
import { contrast, ensureContrast, fromOklch, mix } from "#lib/theme/color.ts";

/** FNV-1a, 32 bit: stable across sessions and platforms. */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Hue (0–359) of a space, derived from its id. */
export const hueOf = (id: string): number => hash(id) % 360;

/** Lightness/chroma tuned so the accent reads on both the light and the dark surface. */
const TONE = { light: { l: 0.62, c: 0.17 }, dark: { l: 0.74, c: 0.14 } } as const;

/**
 * The letter colour on an accent tile (monogram, swatch check): black or white, whichever reads better on the WORSE end
 * of the tile (`accent` -> `accent` 18% toward white), for the hue at this tone.
 */
export function onAccent(dark: boolean, hue: number): "#ffffff" | "#000000" {
	const { l, c } = dark ? TONE.dark : TONE.light;
	const fill = fromOklch({ l, c, h: hue });
	const ends = [fill, mix(fill, "#ffffff", 0.18)];
	const worst = (fg: string) => Math.min(...ends.map((bg) => contrast(fg, bg)));
	return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}

/** OKLCH accent for a space id. `hue` overrides the derived one (user choice later). */
export function accentOf(id: string, dark: boolean, hue?: number): string {
	const { l, c } = dark ? TONE.dark : TONE.light;
	return `oklch(${l} ${c} ${hue ?? hueOf(id)})`;
}

/**
 * The accent as TEXT (port chips, active toggles): the space's hue and chroma, lightness moved until it reads AA on
 * the WORST of `surfaces` (`#rrggbb`). `accentOf` is one fixed lightness, right for dots, rings and tints, but as text
 * it measured 2.3:1 on a raised card (`atlas desktop debug contrast`).
 */
export function accentTextOf(dark: boolean, hue: number, surfaces: string[]): string {
	const { l, c } = dark ? TONE.dark : TONE.light;
	const start = fromOklch({ l, c, h: hue });
	const worst = surfaces.reduce((w, s) => (contrast(start, s) < contrast(start, w) ? s : w));
	return ensureContrast(start, worst, 4.5);
}

/** Soft background tint of the accent, for large surfaces. */
export function tintOf(id: string, dark: boolean, hue?: number): string {
	return `oklch(${dark ? 0.74 : 0.62} ${dark ? 0.14 : 0.17} ${hue ?? hueOf(id)} / ${dark ? 0.1 : 0.07})`;
}

/** Smallest angular distance between two hues. */
const arc = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Spread hues so two spaces never land on near-identical colors: starting from the
 * derived hue, step forward until it is at least `gap` degrees from every earlier space.
 * With more spaces than the circle fits, the hue farthest from the others wins.
 * Deterministic for a given ordered id list.
 */
export function spreadHues(ids: string[], gap = 24): Record<string, number> {
	const out: Record<string, number> = {};
	const used: number[] = [];
	for (const id of ids) {
		const start = hueOf(id);
		let best = start;
		let bestDist = -1;
		for (let step = 0; step < 360; step++) {
			const h = (start + step) % 360;
			const d = used.length ? Math.min(...used.map((u) => arc(u, h))) : 360;
			if (d >= gap) {
				best = h;
				break;
			}
			if (d > bestDist) {
				best = h;
				bestDist = d;
			}
		}
		used.push(best);
		out[id] = best;
	}
	return out;
}

/** The neighbouring space id in `delta` direction, wrapping. `null` when there is nowhere to go. */
export function neighbour(ids: string[], current: string | null, delta: 1 | -1): string | null {
	if (ids.length < 2) return null;
	const i = current ? ids.indexOf(current) : -1;
	if (i < 0) return ids[delta === 1 ? 0 : ids.length - 1];
	return ids[(i + delta + ids.length) % ids.length];
}

/**
 * The neighbour a swipe can reach: like `neighbour` but without wrapping. Keyboard cycling wraps (⌃Tab) and the
 * pager mounts the wrapped neighbours, but a swipe past the first or last space is a rubber band, never a jump
 * to the other end.
 */
export function edgeNeighbour(ids: string[], current: string | null, delta: 1 | -1): string | null {
	const i = current ? ids.indexOf(current) : -1;
	return i < 0 ? null : (ids[i + delta] ?? null);
}

/** The spaces kept mounted around `active`: it and its two neighbours (wrap included), in `ids` order. */
export function mountedWindow(ids: string[], active: string | null): string[] {
	if (!active || !ids.includes(active)) return [];
	const keep = new Set([active, neighbour(ids, active, -1), neighbour(ids, active, 1)]);
	return ids.filter((id) => keep.has(id));
}

/** Direction of a switch from `from` to `to` (1 = content enters from the right). */
export function directionOf(ids: string[], from: string | null, to: string | null): 1 | -1 {
	const a = from ? ids.indexOf(from) : -1;
	const b = to ? ids.indexOf(to) : -1;
	return b >= a ? 1 : -1;
}

/**
 * The spaces to keep mounted: `mountedWindow` (active and its neighbours, which must exist) plus any layer that is
 * already mounted (`held`) and still within two places of the active space (wrap included). Stepping back and forth
 * between two spaces then changes nothing after the first step each way, where a plain window mounts one layer and
 * unmounts another on every selection. In `ids` order.
 */
export function stableWindow(ids: string[], active: string | null, held: string[]): string[] {
	const i = active ? ids.indexOf(active) : -1;
	if (i < 0) return [];
	const near = new Set(mountedWindow(ids, active));
	for (const id of held) {
		const j = ids.indexOf(id);
		if (j < 0) continue;
		const d = Math.abs(j - i);
		if (Math.min(d, ids.length - d) <= 2) near.add(id);
	}
	return ids.filter((id) => near.has(id));
}
