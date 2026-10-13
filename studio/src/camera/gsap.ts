// Camera keys -> GSAP statements on the scene's paused timeline. The camera element (`sel`) is the video's wrapper with
// `transform-origin: 0 0` inside a viewport that clips it; its transform is a function of the pose:
//   scale = fit * zoom * (source.w / proxy.w)   (the proxy may be smaller or larger than the source crop)
//   x = viewport.w/2 - pose.x * s,  y = viewport.h/2 - pose.y * s    with s = fit * zoom (output px per SOURCE px)
// Moves are SAMPLED at the film's frame rate (one linear tween per frame, ease none), so the picture of frame n is
// exactly `poseAt(keys, n / fps)`: the planner's numbers (and the lint's speed checks) are what is on screen, and the
// result does not depend on how GSAP's eases are implemented. Holds and cuts are single `set`s.

import { poseAt, type Pose } from "./plan.ts";
import type { CameraKey, Frame } from "./types.ts";

export interface Transform {
	x: number;
	y: number;
	scale: number;
}

const r = (n: number) => +n.toFixed(3);

/** The CSS transform of the camera element for a pose; `proxy` is the pixel size of the video file the element holds. */
export function cameraTransform(f: Frame, proxy: { w: number }, pose: Pose): Transform {
	const s = (f.viewport.w / f.source.w) * pose.zoom; // output px per source px
	return { x: f.viewport.w / 2 - pose.x * s, y: f.viewport.h / 2 - pose.y * s, scale: s * (f.source.w / proxy.w) };
}

const props = (t: Transform) => `x:${r(t.x)},y:${r(t.y)},scale:${+t.scale.toFixed(5)}`;

/** The GSAP statements for a camera over `duration` seconds at `fps`. */
export function cameraJs(keys: CameraKey[], f: Frame, proxy: { w: number; h: number }, duration: number, fps: number, sel: string): string {
	const at = (t: number) => cameraTransform(f, proxy, poseAt(keys, t));
	const out: string[] = [`tl.set("${sel}",{${props(at(0))}},0);`];
	const step = 1 / fps;
	for (const [i, k] of keys.entries()) {
		if (i === 0) continue;
		if (k.ease === "cut") {
			out.push(`tl.set("${sel}",{${props(at(k.t))}},${+k.t.toFixed(4)});`);
			continue;
		}
		if (k.move <= 0) continue; // a hold: the previous pose stays
		const n = Math.max(1, Math.ceil(k.move * fps - 1e-9));
		for (let j = 0; j < n; j++) {
			const t0 = k.t + j * step;
			const t1 = Math.min(k.t + k.move, t0 + step);
			out.push(`tl.fromTo("${sel}",{${props(at(t0))}},{${props(at(t1))},duration:${+(t1 - t0).toFixed(4)},ease:"none"},${+t0.toFixed(4)});`);
		}
	}
	void duration;
	return out.join("\n");
}
