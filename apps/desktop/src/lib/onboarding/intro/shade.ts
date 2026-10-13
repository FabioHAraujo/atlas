/**
 * Lighting for the Atlas globe. The mark is a gridded sphere, so each tile is shaded from where it sits on that sphere:
 * a key light from the upper left, a rim light at the edge, and a tight specular glint. Pure maths, tested.
 */
import { MARK_VIEW } from "./mark.ts";

/** The globe in logo units: centred in the viewBox, radius half its width. */
export const GLOBE = { cx: MARK_VIEW.w / 2, cy: MARK_VIEW.h / 2, r: MARK_VIEW.w / 2 } as const;

interface V3 {
	x: number;
	y: number;
	z: number;
}

const norm = (v: V3): V3 => {
	const l = Math.hypot(v.x, v.y, v.z) || 1;
	return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Direction towards the key light: upper left, in front of the globe. */
export const KEY_LIGHT: V3 = norm({ x: -0.55, y: -0.6, z: 0.58 });

/** Unit normal of the sphere under a point of the logo (points past the rim clamp to it). */
export function normalAt(x: number, y: number): V3 {
	let nx = (x - GLOBE.cx) / GLOBE.r;
	let ny = (y - GLOBE.cy) / GLOBE.r;
	const d = Math.hypot(nx, ny);
	if (d > 0.999) {
		nx = (nx / d) * 0.999;
		ny = (ny / d) * 0.999;
	}
	return norm({ x: nx, y: ny, z: Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) });
}

export interface Shading {
	diffuse: number;
	rim: number;
	spec: number;
	/** Weighted sum, 0..1. */
	total: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const AMBIENT = 0.28;

/** Light on a unit normal seen from the viewer (looking down -z). */
export function shade(n: V3): Shading {
	const diffuse = clamp01(n.x * KEY_LIGHT.x + n.y * KEY_LIGHT.y + n.z * KEY_LIGHT.z);
	const rim = clamp01((1 - n.z) ** 2.2);
	// Blinn-Phong half vector between the key light and the viewer (0,0,1).
	const h = norm({ x: KEY_LIGHT.x, y: KEY_LIGHT.y, z: KEY_LIGHT.z + 1 });
	const spec = clamp01((n.x * h.x + n.y * h.y + n.z * h.z) ** 90);
	return { diffuse, rim, spec, total: clamp01(AMBIENT + 0.62 * diffuse + 0.35 * rim * 0.5 + 0.5 * spec) };
}
