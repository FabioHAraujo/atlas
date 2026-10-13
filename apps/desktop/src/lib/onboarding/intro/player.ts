/** The intro's clock and its play-once decision. Pure: IntroPlayer.svelte feeds it frames and input. */
import { BEATS, DURATION } from "./timeline.ts";

/** The signature's strike sits this far into the audio file (studio/src/sounds/spec.ts `downbeatSeconds`). */
export const SIGNATURE_PREROLL = 0.08;
/** A frame longer than this is a stall; the clock advances as if it were this long so the hit never jumps. */
const MAX_DT = 0.05;

export type Plan = { mode: "play"; sound: true } | { mode: "settled"; sound: false };

/** Play the intro only on a true first run, with motion allowed and something to paint on. */
export function plan(s: { seen: boolean; reducedMotion: boolean; webgl: boolean }): Plan {
	if (s.seen || s.reducedMotion || !s.webgl) return { mode: "settled", sound: false };
	return { mode: "play", sound: true };
}

export interface Clock {
	t: number;
	state: "running" | "done";
	soundFired: boolean;
	/** Set on the one tick that must start the signature. */
	fireSound?: true;
	stopSound?: undefined;
}

/** Advance the intro by `dt` seconds (or finish it when `skip`). */
export function tick(c: Clock, dt: number, skip: boolean): Clock {
	if (c.state === "done") return c;
	if (skip) return { t: DURATION, state: "done", soundFired: c.soundFired };
	const t = Math.min(DURATION, c.t + Math.min(Math.max(dt, 0), MAX_DT));
	const fire = !c.soundFired && t >= BEATS.hit - SIGNATURE_PREROLL;
	return {
		t,
		state: t >= DURATION ? "done" : "running",
		soundFired: c.soundFired || fire,
		...(fire ? { fireSound: true as const } : {}),
	};
}

export type Loop = "animate" | "static" | "pause";

/** Whether the paint loop runs, draws one still frame, or stops. */
export function loopMode(s: { visible: boolean; focused: boolean; reducedMotion: boolean }): Loop {
	if (!s.visible || !s.focused) return "pause";
	return s.reducedMotion ? "static" : "animate";
}

/**
 * Whether the page counts as focused for pausing animation. An agent instance (`window.__ATLAS_AGENT__`, set by the
 * debug bridge) is never focused by design (it must not steal focus), but nobody is working in another window above
 * it either: its animations must run so they can be shot and recorded.
 */
export const pageIsFocused = (hasFocus: boolean, agentInstance: boolean): boolean =>
	hasFocus || agentInstance;

export interface Backing {
	w: number;
	h: number;
	dpr: number;
}

/** Pixel size of the canvas buffer for a CSS box: device pixels, ratio capped at 2 (4K buffers cost more than they show). */
export function backing(cssW: number, cssH: number, dpr: number): Backing | null {
	if (!(cssW > 0) || !(cssH > 0)) return null;
	const r = dpr > 0 && Number.isFinite(dpr) ? Math.min(dpr, 2) : 1;
	return { w: Math.round(cssW * r), h: Math.round(cssH * r), dpr: r };
}

/** The buffer must be re-sized when it is not what the box needs (checked every frame, so layout settling is caught). */
export const needsResize = (canvas: { width: number; height: number }, want: Backing | null): boolean =>
	want !== null && (canvas.width !== want.w || canvas.height !== want.h);
