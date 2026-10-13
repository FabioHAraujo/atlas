/** Light trails behind flying tiles, and the camera's punch on the hit. Pure geometry, drawn by render.ts. */
import { BEATS } from "./timeline.ts";

export interface RibbonPoint {
	x: number;
	y: number;
	/** Half-width in logo units, tapering to a point. */
	w: number;
	/** 0..1 opacity, fading to the tail. */
	a: number;
}

/** The part of a tile's flight path behind it: from its current offset back toward where it came from. */
export function ribbon(
	tile: { from: { x: number; y: number }; bow: number },
	now: { dx: number; dy: number },
	samples: number,
): RibbonPoint[] {
	const dist = Math.hypot(now.dx, now.dy);
	if (dist < 1) return [];
	const fromLen = Math.hypot(tile.from.x, tile.from.y) || 1;
	// Perpendicular to the approach ray: the same side the tile bows to.
	const px = -tile.from.y / fromLen;
	const py = tile.from.x / fromLen;
	// How far back along the path the trail reaches: long when fast and far, capped so it stays a streak.
	const reach = Math.min(fromLen - dist > 0 ? fromLen - dist : dist, Math.max(60, dist * 0.6));
	const ux = now.dx / dist;
	const uy = now.dy / dist;
	const out: RibbonPoint[] = [];
	for (let i = 0; i < samples; i++) {
		const k = i / (samples - 1);
		const back = reach * k;
		// The bow grows along the trail so it reads as a curve, not a ray.
		const bend = Math.sin(Math.PI * Math.min(1, k * 0.9)) * tile.bow * 0.5 * (back / Math.max(reach, 1));
		out.push({
			x: now.dx + ux * back + px * bend,
			y: now.dy + uy * back + py * bend,
			w: 7 * (1 - k) ** 1.6 + 0.4 * (1 - k),
			a: (1 - k) ** 1.3,
		});
	}
	return out;
}

export interface Camera {
	/** Zoom factor on top of the mark's own scale (1 = rest). */
	zoom: number;
	/** Shake offset in CSS px, decays quickly. */
	shakeX: number;
	shakeY: number;
}

/** Deterministic noise in -1..1 from a time (no Math.random: screenshots must match the live view). */
const noise = (t: number, seed: number) =>
	Math.sin(t * 91.7 + seed * 12.9898) * Math.cos(t * 53.3 + seed * 78.233);

/** The camera punches in on the hit and shakes for a moment; `shake` scales the shake only (0 = none, for reduced motion). */
export function camera(t: number, shake = 1): Camera {
	const dt = t - BEATS.hit;
	if (!(dt >= 0)) return { zoom: 1, shakeX: 0, shakeY: 0 };
	const decay = Math.exp(-dt * 9);
	return {
		zoom: 1 + 0.06 * Math.exp(-dt * 5) * Math.min(1, dt / 0.03 + 0.001),
		shakeX: shake * 7 * decay * noise(t, 1),
		shakeY: shake * 5 * decay * noise(t, 2),
	};
}
